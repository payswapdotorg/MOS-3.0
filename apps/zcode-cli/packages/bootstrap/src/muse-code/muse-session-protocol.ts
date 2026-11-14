import {
  MuseClient,
  type ApprovalHandler,
  type MuseClientSpawnOptions,
  type ResumeSessionOptions,
  type StartSessionOptions,
  type TurnOutcome,
} from "@muse-code/sdk";

import type {
  MuseExecutionPort,
  MuseExecHandlers,
  MuseExecRequest,
  MuseExecRunResult,
  MuseExecApprovalPosture,
  MuseExecStreamEvent,
  MuseSubscriptionUsageSnapshot,
  MuseTurnTokenUsage,
} from "@zcode/contracts";
import {
  DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS,
  ZCODE_VERSION,
  type MuseCodeBackendSettings,
} from "@zcode/shared";
import { buildMuseChildEnv } from "@zcode/shared/node";
import { readMuseCodeBackendSettings } from "./muse-code-settings.js";
import {
  MuseExecStartupError,
  assertMuseWorkspaceContainment,
  resolveMuseExecutableEntry,
} from "./muse-exec-support.js";
import {
  createFileMuseSessionStore,
  lookupMuseSessionId,
  recordMuseSessionMapping,
  type MuseSessionStore,
} from "./muse-session-store.js";

/** SDK 审批请求参数（barrel 未直接导出；从 ApprovalHandler 参数位推导，随 SDK 类型同步）。 */
type MuseApprovalRequest = Parameters<ApprovalHandler>[0];
// Muse Session Protocol（MSP）执行端口（Issue #24 / ACR-0002；PR #27 评审 R1）。
//
// 官方界面：`muse serve` + @muse-code/sdk（exact pin 见 shared
// MUSE_CODE_SDK_PINNED_VERSION；SDK 与 CLI 锁步发版，CLI >= 配对版本才走本面）。
// 相比 `muse exec --json` 的差异化能力（全部来自官方 SDK/protocol 文档）：
// - 会话恢复：startSession/resumeSession（R2），映射持久化跨 MOS 重启。
// - 审批回调：fail-closed 姿态注册 deny 处理器（只选服务端 offered 的拒绝选项，
//   绝不 auto-approve）；unattended-sandboxed = startSession approvalMode
//   "allowAll"（sandbox 独立生效，绝无 `--yolo` 语义）。（R3）
// - workspace 边界：session/start 的 workspaceRoot/workspaceRoots（官方
//   policy-gated root；`:workspace_roots` 规则）。（R4）
// - 用量：turn/completed 的 TokenUsage + usage/read 的订阅窗口百分比。（R6）
//
// 生命周期纪律：每轮一个 host（spawn → open/resume session → 单 turn → close）。
// 不做跨轮常驻 host：取消/超时语义与 exec 面对齐（进程收口），无后台进程残留；
// 会话连续性由 resume 保证，不依赖常驻连接。SDK host 排空上限 5s
// （shutdownTimeoutMs），杜绝关不死的 linger。
//
// 已知边界（诚实记录）：MSP 的 turn/start 没有 `--max-model-steps` 等价成员——
// request.maxModelSteps 在本面被忽略（exec 面继续生效）；步数失控由总超时收口。

const STDERR_LIMIT = 64 * 1024;
const HOST_SHUTDOWN_TIMEOUT_MS = 5_000;
const HOST_STARTUP_TIMEOUT_MS = 60_000;

export interface MuseSessionProtocolDeps {
  env?: NodeJS.ProcessEnv;
  /** 测试注入：覆盖设置读取。 */
  readSettings?: (env: NodeJS.ProcessEnv) => Promise<MuseCodeBackendSettings>;
  /** 测试注入：覆盖会话映射存储。 */
  sessionStore?: MuseSessionStore;
  /** 测试注入：覆盖 host 启动（缺省 MuseClient.spawn）。 */
  spawnClient?: (options: MuseClientSpawnOptions) => Promise<MuseClient>;
  /** 测试注入：写映射失败时的告警出口。 */
  onSessionMapWriteError?: (error: unknown) => void;
}

/** MSP 面端口实现（`muse serve` + @muse-code/sdk）。 */
export function createMuseSessionProtocolPort(
  deps: MuseSessionProtocolDeps = {},
): MuseExecutionPort {
  const env = deps.env ?? process.env;
  const readSettings = deps.readSettings ?? readMuseCodeBackendSettings;
  const sessionStore = deps.sessionStore ?? createFileMuseSessionStore(env);
  const spawnClient = deps.spawnClient ?? ((options) => MuseClient.spawn(options));

  return {
    async runMuseExec(
      request: MuseExecRequest,
      handlers: MuseExecHandlers,
    ): Promise<MuseExecRunResult> {
      // workspace 收敛（R4）：与 exec 面同一判定，越界绝不启动。
      assertMuseWorkspaceContainment(request.workingDirectory, request.workspaceRoot);
      const settings = await readSettings(env);
      const approvalPosture: MuseExecApprovalPosture =
        settings.approvalPosture === "unattended-sandboxed"
          ? "unattended-sandboxed"
          : "fail-closed";
      const timeoutMs =
        request.timeoutMs && request.timeoutMs > 0
          ? request.timeoutMs
          : settings.timeoutMs && settings.timeoutMs > 0
            ? settings.timeoutMs
            : DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS;

      // 进入时已取消：不启动 host，直接返回取消事实。
      if (request.signal.aborted) {
        return emptyResult("cancelled", approvalPosture);
      }

      const executable = resolveMuseExecutableEntry(env, settings, request.executablePath);
      if (!executable) {
        throw new MuseExecStartupError(
          "executableNotFound",
          `Muse Code CLI executable "${settings.executablePath?.trim() || "muse"}" was not found. Install the CLI or set an absolute executable path in MOS Model Settings.`,
        );
      }

      let stderrTail = "";
      let client: MuseClient | undefined;
      const combinedSignal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      let timedOut = false;
      let cancelled = false;
      let approvalRequestsObserved = 0;
      let userQuestionsObserved = 0;
      // 同一请求的 twin 帧（notification + server request）只计数/投影一次。
      const seenApprovalItemIds = new Set<string>();
      const seenQuestionItemIds = new Set<string>();
      const pendingDispatch = new Set<Promise<unknown>>();

      const emit = async (event: MuseExecStreamEvent): Promise<void> => {
        if (combinedSignal.aborted) return;
        await handlers.onEvent(event);
      };
      const track = (p: Promise<unknown>): void => {
        pendingDispatch.add(p);
        void p.finally(() => pendingDispatch.delete(p));
      };
      const settlePumps = async (): Promise<void> => {
        const deadline = Date.now() + HOST_SHUTDOWN_TIMEOUT_MS;
        while (pendingDispatch.size > 0 && Date.now() < deadline) {
          await Promise.allSettled([...pendingDispatch]);
        }
      };
      const onCombinedAbort = () => {
        if (request.signal.aborted) {
          cancelled = true;
        } else {
          timedOut = true;
        }
      };
      combinedSignal.addEventListener("abort", onCombinedAbort, { once: true });

      try {
        client = await withStartupTimeout(
          spawnClient({
            museBin: executable,
            args: ["serve"],
            cwd: request.workingDirectory,
            // 环境隔离（R5）：SDK 的 env 语义是「替换」——传入允许清单构造结果，
            // Host 集成凭据不进入 host 进程树；登录态经 USERPROFILE/APPDATA/HOME 保持。
            env: buildMuseChildEnv(env),
            clientInfo: {
              name: "mos",
              title: "MOS (ZCode delegated execution)",
              version: ZCODE_VERSION,
            },
            shutdownTimeoutMs: HOST_SHUTDOWN_TIMEOUT_MS,
            onStderr: (chunk) => {
              stderrTail = trimStderr(stderrTail + chunk);
            },
          }),
        );

        // 会话映射（R2）：既有映射 → resumeSession；否则 startSession。
        const sessionMap = await sessionStore.read().catch(() => ({}) as Awaited<ReturnType<MuseSessionStore["read"]>>);
        const existingMuseSessionId = lookupMuseSessionId(sessionMap, request.sessionId);
        const resumedMuseSession = existingMuseSessionId !== undefined;

        // 审批决策（R3）：fail-closed 注册 deny 处理器（resume 面必须经 options 传入
        // ——approval 可能在 resume reply 后立刻到达）。deny 只选 offered 的非批准
        // 选项；没有拒绝选项时抛错（handlerThrew → 不发送决定，approval 保持 open，
        // 由总超时收口）。unattended-sandboxed 不注册处理器（allowAll 模式自动放行，
        // sandbox 独立生效）。
        const denyApproval =
          approvalPosture === "fail-closed"
            ? async (approvalRequest: MuseApprovalRequest) => ({
                choiceId: requireDenyChoice(approvalRequest),
              })
            : undefined;

        const session = resumedMuseSession
          ? await client.resumeSession({
              sessionId: existingMuseSessionId,
              ...(denyApproval
                ? { onApproval: denyApproval, onApprovalError: () => undefined }
                : {}),
            } satisfies ResumeSessionOptions)
          : await client.startSession(buildStartSessionOptions(request, approvalPosture));
        if (!resumedMuseSession && denyApproval) {
          session.onApproval(denyApproval);
        }

        // 映射回写（R2）：拿到 session id 即持久化（首轮失败也可下轮续接）。
        const museSessionId = session.sessionId;
        try {
          await sessionStore.write(
            recordMuseSessionMapping(
              await sessionStore.read().catch(() => ({}) as Awaited<ReturnType<MuseSessionStore["read"]>>),
              request.sessionId,
              {
                museSessionId,
                surface: "session-protocol",
                workspaceRoot: request.workspaceRoot,
              },
            ),
          );
        } catch (error) {
          deps.onSessionMapWriteError?.(error);
        }

        // 事件泵（先于 turn 启动）：审批/提问帧如实投影（可见性）。
        // twin 帧按 itemId 去重；泵异常不是 run 失败（结果以 turn 收口为准）。
        const eventsController = new AbortController();
        const pumpSessionEvents = (async () => {
          try {
            for await (const folded of session.events({ signal: eventsController.signal })) {
              if (eventsController.signal.aborted || combinedSignal.aborted) break;
              const frame = folded.frame as { method?: string; params?: unknown };
              const params = (frame.params ?? {}) as Record<string, unknown>;
              if (frame.method === "approval/requested" || frame.method === "approval/request") {
                const itemId = typeof params.itemId === "string" ? params.itemId : "";
                if (itemId && seenApprovalItemIds.has(itemId)) continue;
                if (itemId) seenApprovalItemIds.add(itemId);
                approvalRequestsObserved += 1;
                track(
                  emit({
                    kind: "approval_required",
                    ...(typeof params.toolName === "string" ? { toolName: params.toolName } : {}),
                    ...(summarizeApprovalParams(params)
                      ? { summary: summarizeApprovalParams(params) }
                      : {}),
                  }).catch(() => undefined),
                );
                continue;
              }
              if (frame.method === "userInput/requested" || frame.method === "userInput/request") {
                const itemId = typeof params.itemId === "string" ? params.itemId : "";
                if (itemId && seenQuestionItemIds.has(itemId)) continue;
                if (itemId) seenQuestionItemIds.add(itemId);
                userQuestionsObserved += 1;
                track(
                  emit({ kind: "user_question", summary: summarizeQuestionParams(params) }).catch(
                    () => undefined,
                  ),
                );
              }
            }
          } catch {
            // 泵结束（abort/会话结束）不是错误。
          }
        })();

        const turn = await session.sendUserTurn({
          input: [{ type: "text", text: request.prompt }],
        });
        // 中止 → stop 手势（turn/interrupt，SDK 的用户停止语义）；admission-only，
        // turn 由 completed 收口。此时才持有 turn 引用，故监听在此注册。
        const onAbortInterrupt = () => {
          void turn.interrupt().catch(() => undefined);
        };
        combinedSignal.addEventListener("abort", onAbortInterrupt, { once: true });
        if (combinedSignal.aborted) {
          onAbortInterrupt();
        }

        // 文本流（delta live-only；缺帧兜底在收口后用 fold 的 agentMessage 文本补一次）。
        let sawTextDelta = false;
        const pumpDeltas = (async () => {
          try {
            for await (const delta of turn.deltas()) {
              if (combinedSignal.aborted) break;
              if (delta.field !== undefined && delta.field !== "text") continue;
              if (delta.delta.length === 0) continue;
              sawTextDelta = true;
              track(emit({ kind: "text_delta", text: delta.delta }).catch(() => undefined));
            }
          } catch {
            // delta 流结束不是错误。
          }
        })();

        // 工具行：toolCall item 首见 → started；收口后统一补 completed/error
        // （不依赖未核实的 state 词表；开始时间用首见时刻）。
        const toolItems = new Map<
          string,
          { toolName: string; summary?: string; startedAt: number }
        >();
        // 文本兜底素材：fold 的最后一条 agentMessage 文本（deltas 缺帧时补投影）。
        let lastAgentText: string | undefined;
        const pumpItems = (async () => {
          try {
            for await (const item of turn.items()) {
              if (combinedSignal.aborted) break;
              const record = item as unknown as Record<string, unknown>;
              if (record.kind === "agentMessage" && typeof record.text === "string") {
                lastAgentText = record.text;
                continue;
              }
              if (record.kind !== "toolCall") continue;
              const itemId = typeof record.itemId === "string" ? record.itemId : undefined;
              const key = itemId ?? `muse:tool:${toolItems.size + 1}`;
              const summary = readItemSummary(record);
              const existing = toolItems.get(key);
              if (existing) {
                // 修订帧：只更新摘要（截断），不重复 started。
                if (summary) existing.summary = summary;
                continue;
              }
              const toolName = readItemToolName(record);
              toolItems.set(key, {
                toolName,
                ...(summary ? { summary } : {}),
                startedAt: Date.now(),
              });
              track(
                emit({
                  kind: "tool_activity",
                  toolCallId: key,
                  toolName,
                  status: "started",
                  startedAt: Date.now(),
                }).catch(() => undefined),
              );
            }
          } catch {
            // item 流结束不是错误。
          }
        })();

        let outcome: TurnOutcome;
        try {
          outcome = await turn.completed;
        } catch (error) {
          // durable host 死亡等：completed reject。按执行失败收口。
          throw Object.assign(
            new Error(
              `Muse Session Protocol turn failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
            { code: "ZCODE_MUSE_EXEC_EXIT" },
          );
        }
        // 泵收口：事件流停止（session 级，需显式 abort），delta/item 流随 turn 结束。
        eventsController.abort();
        await Promise.allSettled([pumpSessionEvents, pumpDeltas, pumpItems]);
        await settlePumps();
        combinedSignal.removeEventListener("abort", onAbortInterrupt);

        if (combinedSignal.aborted) {
          return {
            ...emptyResult(cancelled ? "cancelled" : "timeout", approvalPosture),
            stderrTail,
            museSessionId,
            resumedMuseSession,
            approvalRequestsObserved,
            userQuestionsObserved,
          };
        }

        const outcomeResult = interpretOutcome(outcome);
        // 文本兜底（R1 验收路径）：全程未见 text delta 时，用 fold 的最终
        // agentMessage 文本补一次投影（agentMessage item 的 text 字段）。
        if (!sawTextDelta && lastAgentText) {
          await emit({ kind: "text_delta", text: lastAgentText });
          await emit({ kind: "text_end" });
        } else if (sawTextDelta) {
          await emit({ kind: "text_end" });
        }
        // 工具行收尾：未闭合的 toolCall 一律补 completed/error（summary 截断）。
        for (const [key, entry] of toolItems) {
          await emit({
            kind: "tool_activity",
            toolCallId: key,
            toolName: entry.toolName,
            status: outcomeResult.success ? "completed" : "error",
            startedAt: entry.startedAt,
            ...(entry.summary ? { summary: entry.summary } : {}),
          });
        }

        // 用量（R6）：turn/completed 的 TokenUsage（可能缺省 = 未申报）+ 订阅窗口
        // 百分比（best-effort；失败/缺省不阻塞）。
        const usage = outcome.kind === "completed" ? outcome.params.usage : undefined;
        const subscriptionUsage = await readSubscriptionUsage(client).catch(() => undefined);

        return {
          cancelled: false,
          exitCode: outcomeResult.exitCode,
          stderrTail: outcomeResult.stderrHint
            ? `${stderrTail}${stderrTail ? "\n" : ""}${outcomeResult.stderrHint}`
            : stderrTail,
          timedOut: false,
          unknownEventCount: 0,
          surface: "session-protocol",
          museSessionId,
          resumedMuseSession,
          approvalRequestsObserved,
          userQuestionsObserved,
          ...(usage ? { usage: mapTokenUsage(usage) } : {}),
          ...(subscriptionUsage ? { subscriptionUsage } : {}),
          approvalPosture,
        };
      } finally {
        combinedSignal.removeEventListener("abort", onCombinedAbort);
        // host 收口：close 排空上限 5s（spawn 时指定）；失败不覆盖原始错误。
        await client?.close().catch(() => undefined);
      }
    },
  };
}

// ---- helpers ----

function emptyResult(
  reason: "cancelled" | "timeout",
  approvalPosture: MuseExecApprovalPosture,
): MuseExecRunResult {
  return {
    cancelled: reason === "cancelled",
    exitCode: null,
    stderrTail: "",
    timedOut: reason === "timeout",
    unknownEventCount: 0,
    surface: "session-protocol",
    resumedMuseSession: false,
    approvalRequestsObserved: 0,
    userQuestionsObserved: 0,
    approvalPosture,
  };
}

/**
 * fail-closed deny 选择：只选服务端 offered 的非批准 decision（denied →
 * deniedPolicyAmendment → abort）。不存在非批准选项时抛错——绝不批准、
 * 绝不构造 offered 之外的 choiceId（SDK 也会拒绝并报告）。
 */
function requireDenyChoice(request: MuseApprovalRequest): string {
  const choices = request.availableChoices ?? [];
  const denyChoice =
    choices.find((choice) => choice.decision === "denied") ??
    choices.find((choice) => choice.decision === "deniedPolicyAmendment") ??
    choices.find((choice) => choice.decision === "abort");
  if (!denyChoice) {
    throw new Error(
      "fail-closed approval posture: no non-approving choice was offered; refusing to decide (approval stays open and the turn is bounded by the timeout)",
    );
  }
  return denyChoice.choiceId;
}

/**
 * startSession 选项（R4 + R3）：
 * - workspace 边界：cwd == 根时传 workspaceRoot（单根，policy-gated root）；
 *   cwd 是子目录时传 workspaceRoots（首个 = CWD，根纳入 `:workspace_roots` 规则集，
 *   并集 ⊆ MOS workspace——workingDirectory 已通过收敛校验）。
 * - unattended-sandboxed：approvalMode "allowAll"（标准 mode 名；sandbox 独立生效）。
 *   fail-closed：不声明 approvalMode（服务端缺省），deny 处理器负责拒绝。
 */
function buildStartSessionOptions(
  request: MuseExecRequest,
  approvalPosture: MuseExecApprovalPosture,
): StartSessionOptions {
  const sameRoot = sameNormalizedPath(request.workingDirectory, request.workspaceRoot);
  const base: StartSessionOptions = sameRoot
    ? { workspaceRoot: request.workspaceRoot }
    : { workspaceRoots: [request.workingDirectory, request.workspaceRoot] };
  return approvalPosture === "unattended-sandboxed"
    ? { ...base, approvalMode: "allowAll" }
    : base;
}

function sameNormalizedPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function interpretOutcome(outcome: TurnOutcome): {
  success: boolean;
  exitCode: number;
  stderrHint?: string;
} {
  if (outcome.kind !== "completed") {
    return {
      success: false,
      exitCode: 1,
      stderrHint: `Muse turn did not run (outcome: ${outcome.kind})`,
    };
  }
  const params = outcome.params;
  if (params.terminal === "completed") {
    return { success: true, exitCode: 0 };
  }
  const detail =
    params.error?.message ??
    params.reason ??
    `Muse turn ended with terminal "${params.terminal}"`;
  return { success: false, exitCode: 1, stderrHint: detail };
}

function mapTokenUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): MuseTurnTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedTokens: usage.cachedTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
  };
}

async function readSubscriptionUsage(
  client: MuseClient,
): Promise<MuseSubscriptionUsageSnapshot | undefined> {
  const result = await client.readUsage();
  const usage = result.usage;
  if (!usage) return undefined;
  return {
    tier: usage.tier,
    windowUsedPercent: usage.window.usedPercent,
    windowResetsAtMs: usage.window.resetsAtMs,
    weeklyUsedPercent: usage.weekly.usedPercent,
    weeklyResetsAtMs: usage.weekly.resetsAtMs,
  };
}

function summarizeApprovalParams(params: Record<string, unknown>): string | undefined {
  if (typeof params.toolArguments === "string" && params.toolArguments.length > 0) {
    return params.toolArguments.slice(0, 400);
  }
  const requirement = params.currentRequirementId;
  if (requirement !== null && typeof requirement === "object") {
    try {
      return JSON.stringify(requirement).slice(0, 400);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function summarizeQuestionParams(params: Record<string, unknown>): string {
  const questions = params.questions;
  if (Array.isArray(questions)) {
    const texts = questions
      .map((question) =>
        question !== null && typeof question === "object"
          ? String((question as Record<string, unknown>).question ?? "").trim()
          : "",
      )
      .filter((text) => text.length > 0);
    if (texts.length > 0) return texts.join(" | ").slice(0, 500);
  }
  return "the Muse agent asked a question";
}

function readItemToolName(record: Record<string, unknown>): string {
  const toolName = record.toolName;
  if (typeof toolName === "string" && toolName.length > 0) return toolName.slice(0, 128);
  const title = record.title;
  if (typeof title === "string" && title.length > 0) return title.slice(0, 128);
  return "tool";
}

function readItemSummary(record: Record<string, unknown>): string | undefined {
  for (const key of ["summary", "output", "title", "displayLabel"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    }
  }
  return undefined;
}

function trimStderr(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= STDERR_LIMIT) return value;
  return value.slice(-STDERR_LIMIT);
}

async function withStartupTimeout<T>(promise: Promise<T>): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          new MuseExecStartupError(
            "spawnFailed",
            `Muse Code CLI (muse serve) did not complete the Session Protocol handshake within ${HOST_STARTUP_TIMEOUT_MS / 1000}s. Check the CLI version (>= the pinned SDK version) and the execution surface setting in Model Settings.`,
          ),
        );
      }, HOST_STARTUP_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]);
}
