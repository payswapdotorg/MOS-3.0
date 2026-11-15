import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  MuseExecHandlers,
  MuseExecRequest,
  MuseExecRunResult,
  MuseExecStreamEvent,
} from "@zcode/contracts";
import type {
  ApprovalHandler,
  MuseClient,
  MuseClientSpawnOptions,
  ResumeSessionOptions,
  StartSessionOptions,
  TurnOutcome,
} from "@muse-code/sdk";
import {
  DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
  type MuseCodeBackendSettings,
} from "@zcode/shared";
import { createMuseSessionProtocolPort } from "../src/muse-code/muse-session-protocol.js";
import type { MuseSessionMap, MuseSessionStore } from "../src/muse-code/muse-session-store.js";
// Muse Session Protocol（MSP）端口的契约测试（Issue #24 / ACR-0002；PR #27 评审 R1–R6；
// 评审 rev. 3：resume 的 workspace 根门控 + symlink 物理逃逸拒绝；验证轮修正 A/B/C：
// canonical 物理根 resume 门控（symlink retarget 后拒绝续接）、不可解析边界 spawn 前
// 拒绝（真实 workspace 目录）、启动超时后晚到的 client 被 close）。
// @muse-code/sdk 用脚本化 fake client 注入（spawnClient seam）：
// 验证 startSession/resumeSession 的 workspaceRoot/workspaceRoots/approvalMode、
// deny 审批处理器（fail-closed）、环境允许清单、事件投影（delta/item/approval/question）、
// 取消/超时 → interrupt、用量映射与订阅快照、host close。
// 这是 mock 契约证据（SDK facade 层注入），真实 MSP 握手在机验证（evidence §4）。

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

interface FakeFrame {
  method: string;
  params?: Record<string, unknown>;
}

function createMemorySessionStore(initial: MuseSessionMap = {}): MuseSessionStore & {
  map: () => MuseSessionMap;
} {
  let current: MuseSessionMap = { ...initial };
  return {
    map: () => current,
    async read() {
      return { ...current };
    },
    async write(next) {
      current = { ...next };
    },
  };
}

function createFakeSdk(input: {
  museSessionId?: string;
  startSessionError?: Error;
  frames?: FakeFrame[];
  deltas?: { delta: string; field?: string }[];
  items?: Record<string, unknown>[];
  subscriptionUsage?: Awaited<ReturnType<MuseClient["readUsage"]>>;
  completeTerminal?: string;
  failOutcome?: boolean;
  hangTurn?: boolean;
  /** spawnClient 延迟 resolve（验证轮修正 C：超时后晚到的 client）。 */
  spawnDelayMs?: number;
  /** startSession 永不 resolve（验证轮修正 C：会话打开阶段挂起）。 */
  startSessionHang?: boolean;
} = {}) {
  const state = {
    spawnOptions: undefined as MuseClientSpawnOptions | undefined,
    startOptions: undefined as StartSessionOptions | undefined,
    resumeOptions: undefined as ResumeSessionOptions | undefined,
    approvalHandler: undefined as ApprovalHandler | undefined,
    resumeApprovalHandler: undefined as ApprovalHandler | undefined,
    interruptCalled: false,
    closed: false,
    turnInput: undefined as { type: string; text: string }[] | undefined,
    resolveCompleted: undefined as ((outcome: TurnOutcome) => void) | undefined,
  };
  let settled = false;
  const complete = (outcome: TurnOutcome) => {
    if (settled) return;
    settled = true;
    state.resolveCompleted?.(outcome);
  };
  const completed = new Promise<TurnOutcome>((resolve) => {
    state.resolveCompleted = resolve;
  });
  const endOnSettle = completed.then(() => undefined);
  const client = {
    async startSession(options?: StartSessionOptions) {
      if (input.startSessionError) throw input.startSessionError;
      if (input.startSessionHang) {
        // 永不 resolve：验证启动门控必须收口（client 已赋值 → finally close）。
        return new Promise<never>(() => undefined);
      }
      state.startOptions = options ?? {};
      return createFakeSession();
    },
    async resumeSession(options: ResumeSessionOptions) {
      state.resumeOptions = options;
      state.resumeApprovalHandler = options.onApproval;
      return createFakeSession();
    },
    async readUsage() {
      return input.subscriptionUsage ?? {};
    },
    async close() {
      state.closed = true;
      complete({
        kind: "completed",
        params: { terminal: "cancelled" },
      } as unknown as TurnOutcome);
    },
  } as unknown as MuseClient;
  const createFakeSession = () => {
    const session = {
      sessionId: input.museSessionId ?? "muse-session-fake-1",
      onApproval(handler: ApprovalHandler) {
        state.approvalHandler = handler;
      },
      events: async function* ({ signal }: { signal?: AbortSignal } = {}) {
        for (const frame of input.frames ?? []) {
          yield { frame };
        }
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      async sendUserTurn(options: { input: { type: string; text: string }[] }) {
        state.turnInput = options.input;
        return createFakeTurn();
      },
    };
    return session;
  };
  const createFakeTurn = () => ({
    deltas: async function* () {
      for (const delta of input.deltas ?? []) {
        yield { ...delta, itemId: "item-text", sessionId: "s", viewCursor: "c" };
      }
      await endOnSettle;
    },
    items: async function* () {
      for (const item of input.items ?? []) {
        yield item;
      }
      await endOnSettle;
    },
    completed,
    async interrupt() {
      state.interruptCalled = true;
      if (!input.hangTurn) {
        complete(
          (input.failOutcome
            ? {
                kind: "completed",
                params: {
                  terminal: "failed",
                  error: { kind: "runtime", message: "fake turn failure detail" },
                },
              }
            : {
                kind: "completed",
                params: { terminal: input.completeTerminal ?? "cancelled" },
              }) as unknown as TurnOutcome,
        );
      }
    },
  });
  return {
    state,
    complete,
    spawnClient: async (options: MuseClientSpawnOptions) => {
      state.spawnOptions = options;
      if (input.spawnDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, input.spawnDelayMs));
      }
      return client;
    },
  };
}

/** 真实 workspace fixture（验证轮修正 B：收敛校验物理解析失败即拒绝——假路径不再放行）。 */
async function workspaceFixture(prefix = "muse-msp-ws-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { force: true, recursive: true }));
  return dir;
}

function buildRequest(input: {
  workdir?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxModelSteps?: number;
} = {}): MuseExecRequest {
  const workdir = input.workdir ?? "/workspace/fixture-unresolved";
  return {
    prompt: "fix the failing parser test",
    sessionId: "sess_muse_test",
    signal: input.signal ?? new AbortController().signal,
    workingDirectory: workdir,
    workspaceRoot: input.workspaceRoot ?? workdir,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxModelSteps !== undefined ? { maxModelSteps: input.maxModelSteps } : {}),
  };
}

function runPort(input: {
  settings?: Partial<MuseCodeBackendSettings>;
  store?: MuseSessionStore;
  fake: ReturnType<typeof createFakeSdk>;
  request?: MuseExecRequest;
  startupTimeoutMs?: number;
}) {
  const port = createMuseSessionProtocolPort({
    env: {
      PATH: process.env.PATH ?? "",
      HOME: "/home/fixture-user",
      GITHUB_TOKEN: "ghp_host_secret",
      OPENROUTER_API_KEY: "sk-or-host-secret",
    },
    readSettings: async () => ({
      ...DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
      executablePath: "/usr/bin/muse-fake",
      ...input.settings,
    }),
    sessionStore: input.store ?? createMemorySessionStore(),
    spawnClient: input.fake.spawnClient,
    ...(input.startupTimeoutMs !== undefined ? { startupTimeoutMs: input.startupTimeoutMs } : {}),
  });
  const events: MuseExecStreamEvent[] = [];
  const handlers: MuseExecHandlers = {
    onEvent: async (event) => {
      events.push(event);
    },
  };
  return {
    events,
    run: port.runMuseExec(input.request ?? buildRequest(), handlers) as Promise<MuseExecRunResult>,
  };
}

/** 等待条件成立（有界轮询；超时抛错——测试自身不悬挂）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition was not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const completedOutcome = (usage?: Record<string, number>): TurnOutcome =>
  ({
    kind: "completed",
    params: {
      terminal: "completed",
      sessionId: "muse-session-fake-1",
      turnId: "t1",
      viewCursor: "c1",
      ...(usage ? { usage } : {}),
    },
  }) as unknown as TurnOutcome;

describe("createMuseSessionProtocolPort", () => {
  it("starts a session with the official workspace root and the allowlisted environment (R1/R4/R5)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const { run } = runPort({ fake, request: buildRequest({ workdir: root, workspaceRoot: root }) });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    expect(result.exitCode).toBe(0);
    expect(result.surface).toBe("session-protocol");
    expect(result.approvalPosture).toBe("fail-closed");
    // spawn：muse serve + cwd + 允许清单 env + clientInfo；Host 凭据绝不进入。
    expect(fake.state.spawnOptions?.args).toEqual(["serve"]);
    expect(fake.state.spawnOptions?.museBin).toBe("/usr/bin/muse-fake");
    expect(fake.state.spawnOptions?.cwd).toBe(root);
    const env = fake.state.spawnOptions?.env ?? {};
    expect(env.HOME).toBe("/home/fixture-user");
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(typeof fake.state.spawnOptions?.clientInfo.version).toBe("string");
    // startSession：单根 workspaceRoot（cwd == 根）；fail-closed 不声明 approvalMode。
    expect(fake.state.startOptions?.workspaceRoot).toBe(root);
    expect(fake.state.startOptions?.approvalMode).toBeUndefined();
    // 提示以 text part 提交。
    expect(fake.state.turnInput).toEqual([{ type: "text", text: "fix the failing parser test" }]);
    // 会话映射持久化（R2；canonical 物理根 = 记录时 realpath 解析结果）。
    expect(result.museSessionId).toBe("muse-session-fake-1");
    expect(result.resumedMuseSession).toBe(false);
    expect(fake.state.closed).toBe(true);
  });

  it("scopes a subdirectory working directory with workspaceRoots inside the boundary (R4)", async () => {
    const root = await workspaceFixture();
    const sub = join(root, "sub");
    await mkdir(sub);
    const fake = createFakeSdk();
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: sub, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    await runPromise;
    // 首根 = CWD（会话工作目录），workspace 根纳入 :workspace_roots 规则集。
    expect(fake.state.startOptions?.workspaceRoots).toEqual([sub, root]);
    expect(fake.state.startOptions?.workspaceRoot).toBeUndefined();
  });

  it("rejects before spawn when the working directory escapes the workspace root (R4)", async () => {
    const root = await workspaceFixture();
    const elsewhere = await workspaceFixture("muse-msp-elsewhere-");
    const fake = createFakeSdk();
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: elsewhere, workspaceRoot: root }),
      }).run,
    ).rejects.toThrow(/inside the workspace root/i);
  });

  it("rejects before spawn when the working directory escapes through a symlink inside the root (R4 rev. 3)", async () => {
    const parent = await workspaceFixture("muse-msp-escape-");
    const root = join(parent, "ws");
    const outside = join(parent, "outside");
    const link = join(root, "link");
    await mkdir(root);
    await mkdir(join(outside, "sub"), { recursive: true });
    await symlink(outside, link);
    const fake = createFakeSdk();
    // 词法在界内、物理在界外 → 与 exec 面同一收敛判定，绝不启动 host。
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: link, workspaceRoot: root }),
      }).run,
    ).rejects.toThrow(/inside the workspace root/i);
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: join(link, "sub"), workspaceRoot: root }),
      }).run,
    ).rejects.toThrow(/inside the workspace root/i);
  });

  it("rejects before spawn when the workspace boundary cannot be resolved physically (验证轮修正 B)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    // cwd 不存在（ENOENT）→ spawn 前拒绝（workspaceUnresolvable），绝不词法兜底放行。
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: join(root, "missing"), workspaceRoot: root }),
      }).run,
    ).rejects.toMatchObject({ issueCode: "workspaceUnresolvable" });
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: join(root, "gone"), workspaceRoot: join(root, "gone") }),
      }).run,
    ).rejects.toMatchObject({ issueCode: "workspaceUnresolvable" });
  });

  it("resumes the persisted muse session and registers the deny approval handler (R2/R3)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({ museSessionId: "muse-session-resumed-9" });
    const store = createMemorySessionStore({
      sess_muse_test: {
        museSessionId: "muse-session-resumed-9",
        surface: "session-protocol",
        workspaceRoot: root,
        canonicalWorkspaceRoot: root,
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
    const { run } = runPort({
      fake,
      store,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    expect(fake.state.resumeOptions?.sessionId).toBe("muse-session-resumed-9");
    expect(result.resumedMuseSession).toBe(true);
    expect(result.museSessionId).toBe("muse-session-resumed-9");
    // resume 面的 deny 处理器必须随 options 注册（approval 可能在 resume reply 后立刻到达）。
    expect(typeof fake.state.resumeApprovalHandler).toBe("function");
  });

  it("starts a fresh session instead of resuming when the stored canonical root differs (R2/R4)", async () => {
    const root = await workspaceFixture();
    const otherRoot = await workspaceFixture("muse-msp-other-");
    const fake = createFakeSdk({ museSessionId: "muse-session-fresh-2" });
    const store = createMemorySessionStore({
      sess_muse_test: {
        museSessionId: "muse-session-resumed-9",
        surface: "session-protocol",
        workspaceRoot: otherRoot,
        canonicalWorkspaceRoot: otherRoot,
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
    const { run } = runPort({
      fake,
      store,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    // 根不一致 → 不 resumeSession，startSession 在当前根内开新会话。
    expect(fake.state.resumeOptions).toBeUndefined();
    expect(fake.state.startOptions?.workspaceRoot).toBe(root);
    expect(result.resumedMuseSession).toBe(false);
    expect(result.sessionWorkspaceMismatch).toBe(true);
    expect(result.museSessionId).toBe("muse-session-fresh-2");
    // 映射覆写为当前根（下轮在同根内可续接新会话）。
    expect(store.map()["sess_muse_test"]?.workspaceRoot).toBe(root);
    expect(store.map()["sess_muse_test"]?.canonicalWorkspaceRoot).toBe(root);
  });

  it("refuses resume for legacy mappings without a canonical root (fail-closed)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({ museSessionId: "muse-session-fresh-3" });
    const store = createMemorySessionStore({
      sess_muse_test: {
        museSessionId: "muse-session-resumed-9",
        surface: "session-protocol",
        workspaceRoot: root,
        canonicalWorkspaceRoot: "",
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
    const { run } = runPort({
      fake,
      store,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    // 缺 canonical（旧映射/记录时不可解析）→ 拒绝续接，当前根内开新会话。
    expect(fake.state.resumeOptions).toBeUndefined();
    expect(result.resumedMuseSession).toBe(false);
    expect(result.sessionWorkspaceMismatch).toBe(true);
  });

  it("keeps resume continuity across symlinked workspace-root aliases (R2/R4)", async () => {
    const parent = await workspaceFixture("muse-msp-alias-");
    const realRoot = join(parent, "real-root");
    const alias = join(parent, "alias");
    await mkdir(realRoot);
    await symlink(realRoot, alias);
    const fake = createFakeSdk({ museSessionId: "muse-session-resumed-9" });
    const store = createMemorySessionStore({
      sess_muse_test: {
        museSessionId: "muse-session-resumed-9",
        surface: "session-protocol",
        workspaceRoot: realRoot,
        canonicalWorkspaceRoot: realRoot,
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
    // 映射记录 canonical 物理根；当前请求根是它的 symlink 别名（同一物理目录）→ 续接保持。
    const { run } = runPort({
      fake,
      store,
      request: buildRequest({ workdir: alias, workspaceRoot: alias }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    expect(fake.state.resumeOptions?.sessionId).toBe("muse-session-resumed-9");
    expect(result.resumedMuseSession).toBe(true);
    expect(result.sessionWorkspaceMismatch).toBeUndefined();
  });

  it("refuses the old session after the workspace symlink is retargeted, even with the identical path string (验证轮修正 A)", async () => {
    const parent = await workspaceFixture("muse-msp-retarget-");
    const firstRoot = join(parent, "ws-one");
    const secondRoot = join(parent, "ws-two");
    const link = join(parent, "link");
    await mkdir(firstRoot);
    await mkdir(secondRoot);
    await symlink(firstRoot, link);
    // 映射经 symlink 建立：canonical 物理根 = ws-one，记录原串 = link。
    const store = createMemorySessionStore({
      sess_muse_test: {
        museSessionId: "muse-session-old-1",
        surface: "session-protocol",
        workspaceRoot: link,
        canonicalWorkspaceRoot: firstRoot,
        updatedAt: "2026-11-14T00:00:00.000Z",
      },
    });
    // retarget：link → ws-two（同一路径串，物理目标已换）。
    await rm(link);
    await symlink(secondRoot, link);
    const fake = createFakeSdk({ museSessionId: "muse-session-fresh-after-retarget" });
    const { run } = runPort({
      fake,
      store,
      request: buildRequest({ workdir: link, workspaceRoot: link }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    // 词法同串不再是捷径：旧 muse 会话必须被拒绝，当前（新）根内开新会话。
    expect(fake.state.resumeOptions).toBeUndefined();
    expect(fake.state.startOptions?.workspaceRoot).toBe(link);
    expect(result.resumedMuseSession).toBe(false);
    expect(result.sessionWorkspaceMismatch).toBe(true);
    // 映射自愈为当前 canonical 根（ws-two）。
    expect(store.map()["sess_muse_test"]?.canonicalWorkspaceRoot).toBe(secondRoot);
  });

  it("closes a client that resolves after the startup timeout and fails visibly (验证轮修正 C)", async () => {
    const root = await workspaceFixture();
    // spawnClient 在启动超时之后才 resolve：超时必须先对外失败，晚到的 client 随后被 close。
    const fake = createFakeSdk({ spawnDelayMs: 300 });
    const runPromise = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
      startupTimeoutMs: 60,
    }).run;
    await expect(runPromise).rejects.toMatchObject({
      issueCode: "spawnFailed",
      name: "MuseExecStartupError",
    });
    // 晚到的 client 进程树必须收口（close 排空 + 升级语义在 SDK host 内）。
    await waitFor(() => fake.state.closed);
    expect(fake.state.closed).toBe(true);
  });

  it("fails visibly and closes the client when session open hangs past the startup timeout (验证轮修正 C)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({ startSessionHang: true });
    await expect(
      runPort({
        fake,
        request: buildRequest({ workdir: root, workspaceRoot: root }),
        startupTimeoutMs: 60,
      }).run,
    ).rejects.toMatchObject({ issueCode: "spawnFailed", name: "MuseExecStartupError" });
    // client 已赋值 → finally close（host 收口，无残留进程）。
    expect(fake.state.closed).toBe(true);
    expect(fake.state.turnInput).toBeUndefined();
  });

  it("answers approvals with an offered deny choice only, never approving (R3)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const handler = fake.state.approvalHandler;
    expect(handler).toBeDefined();
    const decision = await handler!({
      approvalId: "ap-1",
      availableChoices: [
        { choiceId: "approve-once", decision: "approved", label: "Allow once" },
        { choiceId: "deny-once", decision: "denied", label: "Deny" },
      ],
    } as never);
    expect(decision).toEqual({ choiceId: "deny-once" });
    // 只有批准选项时必须拒绝决定（fail-closed：绝不批准）。
    await expect(
      handler!({
        approvalId: "ap-2",
        availableChoices: [{ choiceId: "approve-once", decision: "approved", label: "Allow" }],
      } as never),
    ).rejects.toThrow(/refusing to decide/i);
    fake.complete(completedOutcome());
    await runPromise;
  });

  it("uses approvalMode allowAll for the unattended posture and registers no deny handler (R3)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const { run } = runPort({
      fake,
      settings: { approvalPosture: "unattended-sandboxed" },
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    const result = await runPromise;
    expect(fake.state.startOptions?.approvalMode).toBe("allowAll");
    expect(result.approvalPosture).toBe("unattended-sandboxed");
    expect(fake.state.approvalHandler).toBeUndefined();
  });

  it("projects live deltas, tool items, approvals and questions with dedupe (R3/streaming)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({
      deltas: [{ delta: "Hello " }, { delta: "world" }, { delta: "meta", field: "summary.0" }],
      items: [
        { kind: "agentMessage", itemId: "item-text", text: "Hello world" },
        { kind: "toolCall", itemId: "item-tool-1", toolName: "Bash", summary: "npm test" },
        { kind: "toolCall", itemId: "item-tool-1", toolName: "Bash", summary: "npm test (done)" },
      ],
      frames: [
        { method: "approval/requested", params: { itemId: "item-tool-1", toolName: "Bash", toolArguments: "npm test" } },
        { method: "approval/request", params: { itemId: "item-tool-1", toolName: "Bash" } },
        { method: "userInput/requested", params: { itemId: "item-q", questions: [{ id: "q1", question: "Which database engine?" }] } },
      ],
    });
    const { events, run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 40));
    fake.complete(completedOutcome());
    const result = await runPromise;
    // 文本流：text 字段 delta 投影；非 text 字段跳过。
    const text = events
      .filter((event) => event.kind === "text_delta")
      .map((event) => (event.kind === "text_delta" ? event.text : ""))
      .join("");
    expect(text).toBe("Hello world");
    expect(events.some((event) => event.kind === "text_end")).toBe(true);
    // 工具行：首见 started，收口补 completed（同 item 修订不重复 started）。
    const toolEvents = events.filter(
      (event) => event.kind === "tool_activity" && event.toolName === "Bash",
    );
    expect(toolEvents.filter((event) => event.kind === "tool_activity" && event.status === "started")).toHaveLength(1);
    const toolDone = toolEvents.find((event) => event.kind === "tool_activity" && event.status === "completed");
    expect(toolDone && toolDone.kind === "tool_activity" ? toolDone.summary : "").toContain("done");
    // 审批/提问可见 + twin 帧去重。
    const approval = events.find((event) => event.kind === "approval_required");
    expect(approval && approval.kind === "approval_required" ? approval.toolName : "").toBe("Bash");
    expect(result.approvalRequestsObserved).toBe(1);
    const question = events.find((event) => event.kind === "user_question");
    expect(question && question.kind === "user_question" ? question.summary : "").toContain(
      "database engine",
    );
    expect(result.userQuestionsObserved).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  it("maps turn token usage and the subscription usage snapshot (R6)", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({
      subscriptionUsage: {
        usage: {
          tier: "contributor",
          window: { usedPercent: 42, resetsAtMs: 1_772_000_000_000, windowDurationMins: 300 },
          weekly: { usedPercent: 12, resetsAtMs: 1_772_500_000_000 },
        },
      } as never,
    });
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(
      completedOutcome({
        inputTokens: 120,
        outputTokens: 30,
        reasoningTokens: 5,
        cachedTokens: 8,
        cacheReadTokens: 6,
        cacheWriteTokens: 2,
      }),
    );
    const result = await runPromise;
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, cachedTokens: 8 });
    expect(result.subscriptionUsage).toMatchObject({
      tier: "contributor",
      windowUsedPercent: 42,
      weeklyUsedPercent: 12,
    });
  });

  it("falls back to the folded agent message text when no text delta was observed", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({
      items: [{ kind: "agentMessage", itemId: "item-text", text: "folded final answer" }],
    });
    const { events, run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.complete(completedOutcome());
    await runPromise;
    const text = events
      .filter((event) => event.kind === "text_delta")
      .map((event) => (event.kind === "text_delta" ? event.text : ""))
      .join("");
    expect(text).toBe("folded final answer");
  });

  it("interrupts the turn and reports cancellation on request signal abort", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const controller = new AbortController();
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root, signal: controller.signal }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort(new Error("user stopped the task"));
    const result = await runPromise;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(fake.state.interruptCalled).toBe(true);
    expect(fake.state.closed).toBe(true);
  });

  it("enforces the overall timeout with interrupt and reports timedOut", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root, timeoutMs: 250 }),
    });
    const result = await run;
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(fake.state.interruptCalled).toBe(true);
    expect(fake.state.closed).toBe(true);
  }, 15_000);

  it("surfaces failed turn outcomes as nonzero exit with the failure detail", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk({ failOutcome: true });
    const { run } = runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root }),
    });
    const runPromise = run.then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.state.resolveCompleted?.(
      ({
        kind: "completed",
        params: {
          terminal: "failed",
          error: { kind: "runtime", message: "quota exhausted" },
        },
      }) as unknown as TurnOutcome,
    );
    const result = await runPromise;
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain("quota exhausted");
  });

  it("returns immediately without spawning when the request signal is already aborted", async () => {
    const root = await workspaceFixture();
    const fake = createFakeSdk();
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));
    const result = await runPort({
      fake,
      request: buildRequest({ workdir: root, workspaceRoot: root, signal: controller.signal }),
    }).run;
    expect(result.cancelled).toBe(true);
    expect(result.surface).toBe("session-protocol");
    expect(fake.state.spawnOptions).toBeUndefined();
  });
});
