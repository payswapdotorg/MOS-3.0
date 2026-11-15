import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { V4CommandExecutor } from "../src/zcode-protocol-v4/commands/executor.js";
import type { SendInputOptions } from "../src/app/types.js";
import type {
  V4CommandCoreHost,
  V4SessionRecordView,
} from "../src/zcode-protocol-v4/commands/types.js";
// MC-D 按选型路由的 handler 级测试（验证轮加严，TL correction round 2026-11-15）：
// 证明**选型驱动的委托路由把模型选型（含精确 modelId）送进 Core 的 sendInput
// options**——不是只有路由 helper 返回 true。链路闭环：
// handler（executionBackend + intent.modelSelection）→ core executeTurnCommand
// （admittedModelSelection = options.intent.modelSelection）→ runDelegatedMuseTurn
// （museDelegatedModelPinOf → port request.modelId，core 测试已断言）→ 端口
// （MSP model/list + start/resume/setModel；exec --model，bootstrap 测试已断言）。
// 覆盖：sendText 显式选型 / sendText 会话常驻选型 / createSession.firstInput /
// Studio 关联会话提交（mission 挂 zcode 会话，经同一 sendText 命令面，无独立
// Studio 提交面——按构造覆盖，见 ACR-0002 §Revision 5）/ 普通选型保持普通路径 /
// OpenCode Zen -free 免费变体保持显式免费 HTTP 路径 / 设置关闭零改道。

const CONTRIBUTOR_SELECTION = {
  providerId: "meta",
  modelId: "muse-spark-1.3-contributor",
};
const ORDINARY_SELECTION = { providerId: "openrouter", modelId: "glm-5.3" };
const FREE_VARIANT_SELECTION = {
  providerId: "opencode-zen-chat",
  modelId: "muse-spark-1.2-contributor-free",
};

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

let settingsPath: string | undefined;
let previousSettingsEnv: string | undefined;

beforeEach(async () => {
  // 路由 helper 缺省读 process.env 的设置文件（与执行端口/服务同一文件）。
  const dir = await mkdtemp(join(tmpdir(), "muse-selection-routing-"));
  cleanups.push(() => rm(dir, { force: true, recursive: true }));
  settingsPath = join(dir, "muse-code-backend.json");
  await writeFile(settingsPath, JSON.stringify({ useAsTaskBackend: true }), "utf8");
  previousSettingsEnv = process.env.ZCODE_MUSE_CODE_SETTINGS_FILE;
  process.env.ZCODE_MUSE_CODE_SETTINGS_FILE = settingsPath;
});

afterEach(() => {
  if (previousSettingsEnv === undefined) {
    delete process.env.ZCODE_MUSE_CODE_SETTINGS_FILE;
  } else {
    process.env.ZCODE_MUSE_CODE_SETTINGS_FILE = previousSettingsEnv;
  }
});

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    sendInput: vi.fn().mockImplementation(async (_input, options) => {
      options?.onTurnStartedObserved?.({
        id: "event-started",
        type: "TurnStarted",
        payload: { messageId: "msg-event-started" },
      });
      return {
        completion: Promise.resolve({}),
        kind: "started_turn",
        turnId: "turn-1",
      };
    }),
    getModel: vi.fn().mockReturnValue("openrouter/glm-5.3"),
    getMode: vi.fn().mockReturnValue("build"),
    runtime: {
      getSessionModelSelection: vi.fn().mockReturnValue(ORDINARY_SELECTION),
      getPlanEnabled: vi.fn().mockReturnValue(false),
    },
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<V4SessionRecordView> & { app?: ReturnType<typeof makeApp> } = {},
): V4SessionRecordView {
  return {
    app: (overrides.app ?? makeApp()) as unknown as V4SessionRecordView["app"],
    workspace: { workspacePath: "/w" },
    persistence: "immediate",
    ...overrides,
  } as V4SessionRecordView;
}

function makeHost(
  record: V4SessionRecordView,
  overrides: Partial<V4CommandCoreHost> = {},
): V4CommandCoreHost {
  return {
    getRecord: (id) => (id === "s1" ? record : undefined),
    waitForProjectionEventCommit: async () => {},
    ...overrides,
  };
}

function envelope(type: string, payload: unknown, sessionId = "s1"): CommandEnvelope {
  return {
    type,
    payload,
    sessionId,
    commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`,
    clientId: "client-test",
    issuedAt: 1,
    baseRevision: 0,
  } as unknown as CommandEnvelope;
}

async function executeSendText(input: {
  payload: Record<string, unknown>;
  app?: ReturnType<typeof makeApp>;
  hostOverrides?: Partial<V4CommandCoreHost>;
}): Promise<SendInputOptions | undefined> {
  const app = input.app ?? makeApp();
  const record = makeRecord({ app });
  const executor = new V4CommandExecutor(makeHost(record, input.hostOverrides));
  await executor.execute(envelope("sendText", input.payload));
  const calls = (app.sendInput as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[1] as SendInputOptions | undefined;
}

describe("MC-D 选型驱动委托路由（handler 级：sendInput options 携带选型与后端）", () => {
  it("sendText with an explicit Contributor selection routes delegated and carries the selection into Core", async () => {
    const options = await executeSendText({
      payload: { text: "run the task", modelSelection: CONTRIBUTOR_SELECTION },
    });
    // 委托路由成立：信封换算的 executionBackend 送进 Core sendInput options。
    expect(options?.executionBackend).toBe("muse-code");
    // 精确选型（用户提交的 modelId——即到达执行端口的 id）随 intent 送进 Core。
    expect(options?.intent?.modelSelection).toEqual(CONTRIBUTOR_SELECTION);
    expect(options?.intent?.modelSelection?.modelId).toBe("muse-spark-1.3-contributor");
  });

  it("sendText with the session's standing Contributor selection routes delegated (cold resume / Studio path)", async () => {
    // 载荷不带选型；会话常驻选型（runtime.getSessionModelSelection）命中家族。
    const options = await executeSendText({
      payload: { text: "continue the standing selection" },
      app: makeApp({
        runtime: {
          getSessionModelSelection: vi.fn().mockReturnValue(CONTRIBUTOR_SELECTION),
          getPlanEnabled: vi.fn().mockReturnValue(false),
        },
      }),
    });
    expect(options?.executionBackend).toBe("muse-code");
    expect(options?.intent?.modelSelection).toEqual(CONTRIBUTOR_SELECTION);
  });

  it("a Studio mission-linked session submission routes delegated through the same sendText command surface", async () => {
    // Studio 关联会话（mission 挂 zcode 会话）没有独立提交面：mission 侧的输入经
    // 同一 sendText 命令送达（source 携带会话来源），CLI 侧选型路由按构造覆盖
    // （ACR-0002 §Revision 5 Studio parity）。模拟 Studio 关联会话的提交形状：
    // 常驻 Contributor 选型 + 会话来源 source。
    const options = await executeSendText({
      payload: {
        text: "studio mission-linked input",
        source: { kind: "session", sessionId: "studio-mission-session-1" },
      },
      app: makeApp({
        runtime: {
          getSessionModelSelection: vi.fn().mockReturnValue(CONTRIBUTOR_SELECTION),
          getPlanEnabled: vi.fn().mockReturnValue(false),
        },
      }),
    });
    expect(options?.executionBackend).toBe("muse-code");
    expect(options?.intent?.modelSelection?.modelId).toBe("muse-spark-1.3-contributor");
  });

  it("createSession.firstInput with a Contributor selection routes delegated and carries the selection", async () => {
    const app = makeApp();
    const record = makeRecord({ app, persistence: "deferred" });
    const createSessionRecord = vi.fn().mockImplementation(async () => ({
      sessionId: "s1",
    }));
    const executor = new V4CommandExecutor(
      makeHost(record, { createSessionRecord }),
    );
    await executor.execute(
      envelope(
        "createSession",
        {
          workspaceId: "/w",
          firstInput: { text: "first task", modelSelection: CONTRIBUTOR_SELECTION },
        },
        "draft",
      ),
    );
    const calls = (app.sendInput as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const options = calls[calls.length - 1]?.[1] as SendInputOptions | undefined;
    expect(options?.executionBackend).toBe("muse-code");
    expect(options?.intent?.modelSelection).toEqual(CONTRIBUTOR_SELECTION);
  });

  it("ordinary model selections stay on the ordinary provider path (no silent rerouting)", async () => {
    const options = await executeSendText({
      payload: { text: "ordinary model task", modelSelection: ORDINARY_SELECTION },
    });
    // 普通选型绝不改道：无 executionBackend，intent 选型保持原样（普通 provider 路径）。
    expect(options?.executionBackend).toBeUndefined();
    expect(options?.intent?.modelSelection).toEqual(ORDINARY_SELECTION);
  });

  it("the OpenCode Zen -free variant stays on its explicit free HTTP path (never the CLI subscription)", async () => {
    const options = await executeSendText({
      payload: { text: "free variant task", modelSelection: FREE_VARIANT_SELECTION },
    });
    expect(options?.executionBackend).toBeUndefined();
    expect(options?.intent?.modelSelection).toEqual(FREE_VARIANT_SELECTION);
  });

  it("requires the Host opt-in: backend disabled means zero rerouting even for family selections", async () => {
    // 设置关闭（useAsTaskBackend: false）：家族选型也走普通路径（零行为变化）。
    await writeFile(settingsPath!, JSON.stringify({ useAsTaskBackend: false }), "utf8");
    const options = await executeSendText({
      payload: { text: "backend disabled task", modelSelection: CONTRIBUTOR_SELECTION },
    });
    expect(options?.executionBackend).toBeUndefined();
    expect(options?.intent?.modelSelection).toEqual(CONTRIBUTOR_SELECTION);
  });

  it("the explicit envelope field still routes delegated regardless of the selection", async () => {
    // 显式信封字段路径（renderer 双门控携带；旧端兼容）保持既有语义：字段优先。
    const app = makeApp();
    const record = makeRecord({ app });
    const executor = new V4CommandExecutor(makeHost(record));
    const command = envelope("sendText", {
      text: "explicit envelope path",
      modelSelection: ORDINARY_SELECTION,
    });
    (command as { executionBackend?: string }).executionBackend = "muse-code";
    await executor.execute(command);
    const calls = (app.sendInput as ReturnType<typeof vi.fn>).mock.calls;
    const options = calls[calls.length - 1]?.[1] as SendInputOptions | undefined;
    expect(options?.executionBackend).toBe("muse-code");
    // 普通选型 + 显式字段：委托执行但不钉模型（CLI 自身配置；core 不钉——
    // museDelegatedModelPinOf 对普通选型返回 undefined）。
    expect(options?.intent?.modelSelection).toEqual(ORDINARY_SELECTION);
  });
});
