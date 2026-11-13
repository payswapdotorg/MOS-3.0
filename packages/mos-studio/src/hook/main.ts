import { SystemTimePort, workspaceFactsFromPath } from "@mos/adapters";
import type { TaskCreatedListener } from "@mos/adapters";
import { IdentityBridgeService } from "@mos/identity-bridge";
import { MissionSidecarService, MissionStore } from "@mos/missions";
import {
  SESSION_START_SOURCE_STARTUP,
} from "../contract/studio-vocabulary.js";
import { parseSessionStartHookPayload } from "../contract/hook-payload.js";
import { operatorAsUserIdentity, type OperatorRecord } from "../contract/operator.js";
import { OperatorStore } from "../application/operator-store.js";

/**
 * SessionStart hook 的 sidecar 接线（生产，结构性）：
 * ZCode 在每个新任务首个回合触发 SessionStart(source=startup) 并把 payload 投到 stdin；
 * 这里把它转成 TaskCreatedEvent 事实，经 @mos/missions 的 MissionSidecarService
 * （graceful failure）落 mission——绝不参与、阻塞或改写标准任务路径
 * （hooks.json 声明 onError=allow；本进程任何路径都以 exit 0 结束）。
 */

export interface HookRunEnvironment {
  readonly dataDir: string | null;
  readonly time: { now(): string };
  readonly operatorStore: {
    load(): Promise<OperatorRecord | null>;
  };
  readonly missionStore: MissionStore;
  readonly identityBridge: IdentityBridgeService;
  readonly sidecar: MissionSidecarService;
  readonly log: (line: string) => void;
}

export interface HookRunOutcome {
  readonly outcome: "mission_created" | "skipped" | "sidecar_error" | "timeout";
  readonly sessionId: string | null;
  readonly sidecarErrors: readonly { stage: string; message: string }[];
}

/** 事实端口：payload 事实 + 操作者声明；观察只在该进程内单次发射。 */
export function hookSessionFactsPort(options: {
  dataDir: string | null;
  payload: { sessionId: string; cwd: string };
  operatorStore: { load(): Promise<OperatorRecord | null> };
}) {
  let listener: TaskCreatedListener | null = null;
  const workspace = workspaceFactsFromPath(options.payload.cwd, null);
  const session = {
    sessionId: options.payload.sessionId,
    taskId: options.payload.sessionId,
    workspace,
  };
  return {
    currentSession: () => Promise.resolve(session),
    currentUser: async () => {
      const operator = options.operatorStore ? await options.operatorStore.load() : null;
      return operator ? operatorAsUserIdentity(operator) : null;
    },
    observeTaskCreated: (subscribe: TaskCreatedListener) => {
      listener = subscribe;
      return () => {
        listener = null;
      };
    },
    emit: (event: { sessionId: string; occurredAt: string }) => {
      listener?.({
        sessionId: event.sessionId,
        taskId: event.sessionId,
        workspace,
        occurredAt: event.occurredAt,
      });
    },
  };
}

const SETTLEMENT_TIMEOUT_MS = 3_000;
const SETTLEMENT_POLL_MS = 25;

/** 处理一段 stdin payload（已读入字符串）。始终正常返回；异常不外抛。 */
export async function runSessionStartHook(
  stdin: string,
  env: Partial<HookRunEnvironment> = {},
): Promise<HookRunOutcome> {
  const payload = parseSessionStartHookPayload(stdin);
  if (!payload) {
    return { outcome: "skipped", sessionId: null, sidecarErrors: [] };
  }
  const dataDir = env.dataDir ?? (process.env.ZCODE_PLUGIN_DATA?.trim() || null);
  const time = env.time ?? new SystemTimePort();
  const log = env.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  // 只有 source=startup（新任务首个回合）视为任务创建事实；resume/fork/clear/compact 不是。
  if (payload.source !== SESSION_START_SOURCE_STARTUP) {
    log(
      JSON.stringify({
        hook: "mos-studio",
        outcome: "skipped",
        reason: `source=${payload.source}`,
        sessionId: payload.sessionId,
      }),
    );
    return { outcome: "skipped", sessionId: payload.sessionId, sidecarErrors: [] };
  }
  if (!dataDir) {
    log(
      JSON.stringify({
        hook: "mos-studio",
        outcome: "sidecar_error",
        reason: "ZCODE_PLUGIN_DATA missing",
        sessionId: payload.sessionId,
      }),
    );
    return { outcome: "sidecar_error", sessionId: payload.sessionId, sidecarErrors: [] };
  }

  const operatorStore = env.operatorStore ?? new OperatorStore({ directory: dataDir });
  const sessionFacts = hookSessionFactsPort({
    dataDir,
    payload: { sessionId: payload.sessionId, cwd: payload.cwd },
    operatorStore,
  });
  const identityBridge =
    env.identityBridge ?? new IdentityBridgeService({ sessionFacts });
  const missionStore =
    env.missionStore ?? new MissionStore({ directory: dataDir, time });
  const sidecar = env.sidecar ?? new MissionSidecarService();

  const attachment = sidecar.attachToSessionFacts({
    sessionFacts,
    identityBridge,
    store: missionStore,
    time,
  });
  try {
    sessionFacts.emit({
      sessionId: payload.sessionId,
      occurredAt: payload.timestamp,
    });
    const settled = await waitForSettlement({
      missionStore,
      identityBridge,
      sessionId: payload.sessionId,
      deadline: Date.now() + SETTLEMENT_TIMEOUT_MS,
    });
    const outcome: HookRunOutcome["outcome"] =
      settled === "mission"
        ? "mission_created"
        : settled === "error"
          ? "sidecar_error"
          : "timeout";
    log(
      JSON.stringify({
        hook: "mos-studio",
        outcome,
        sessionId: payload.sessionId,
        sidecarErrors: sidecar.lastErrors().map((failure) => ({
          stage: failure.stage,
          message: failure.message,
        })),
      }),
    );
    return { outcome, sessionId: payload.sessionId, sidecarErrors: [...sidecar.lastErrors()] };
  } finally {
    attachment.dispose();
  }
}

/** 等待 sidecar 落定：mission 出现（同 tenant 同 session）或失败记录出现或超时。 */
async function waitForSettlement(options: {
  missionStore: MissionStore;
  identityBridge: IdentityBridgeService;
  sessionId: string;
  deadline: number;
}): Promise<"mission" | "error" | "timeout"> {
  while (Date.now() < options.deadline) {
    const resolution = await options.identityBridge.resolveTenantContext();
    if (resolution.status === "resolved") {
      const missions = options.missionStore.listMissions(
        resolution.tenantContext.tenant_id,
        { source_zcode_session_id: options.sessionId },
      );
      if (missions.length > 0) return "mission";
    } else {
      // tenant 不可解析（如操作者未声明）：sidecar 会以 resolve_tenant 失败落定。
      return "error";
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLEMENT_POLL_MS));
  }
  return "timeout";
}

/** stdin 全量读取（ZCode hook 投递为单段 JSON + 换行）。 */
export async function readStdinFully(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
