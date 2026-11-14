import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MuseExecStreamEvent } from "@zcode/contracts";
import type { MuseCodeBackendSettings } from "@zcode/shared";
import { DEFAULT_MUSE_CODE_BACKEND_SETTINGS } from "@zcode/shared";
import { createMuseExecProcessPort } from "../src/muse-code/muse-exec-process.js";
import type { MuseSessionMap, MuseSessionStore } from "../src/muse-code/muse-session-store.js";
// muse exec 子进程端口的契约测试（Issue #24 / ACR-0002；PR #27 评审修订 R2–R6）：
// 用 mock CLI（fixtures/muse-code/mock-muse-cli.mjs）验证 spawn/流式/取消/超时/退出码语义、
// workspace 收敛、环境允许清单、审批姿态旗标、会话续接与审批/提问可见性。
// 这是 mock 契约证据，不是真实 Meta CLI 的执行证据（AGENTS.md §7：contract-tested）。

const FIXTURE_URL = new URL("./fixtures/muse-code/mock-muse-cli.mjs", import.meta.url);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

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

async function prepareFixture(env: NodeJS.ProcessEnv = {}): Promise<{
  env: NodeJS.ProcessEnv;
  settings: MuseCodeBackendSettings;
  workdir: string;
  fixturePath: string;
}> {
  const workdir = await mkdtemp(join(tmpdir(), "muse-exec-test-"));
  cleanups.push(() => rm(workdir, { force: true, recursive: true }));
  const fixtureCopy = join(workdir, "mock-muse-cli.mjs");
  await copyFile(fileURLToPath(FIXTURE_URL), fixtureCopy);
  await chmod(fixtureCopy, 0o755);
  return {
    env,
    settings: { ...DEFAULT_MUSE_CODE_BACKEND_SETTINGS, executablePath: fixtureCopy },
    workdir,
    fixturePath: fixtureCopy,
  };
}

function runPort(input: {
  env: NodeJS.ProcessEnv;
  settings: MuseCodeBackendSettings;
  workdir: string;
  prompt?: string;
  sessionId?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxModelSteps?: number;
  executablePath?: string;
  sessionStore?: MuseSessionStore;
  onEvent?: (event: MuseExecStreamEvent) => void;
}) {
  const port = createMuseExecProcessPort({
    env: input.env,
    readSettings: async () => input.settings,
    sessionStore: input.sessionStore ?? createMemorySessionStore(),
  });
  const events: MuseExecStreamEvent[] = [];
  return {
    events,
    run: port.runMuseExec(
      {
        prompt: input.prompt ?? "refactor the parser module",
        sessionId: input.sessionId ?? "sess_muse_test",
        signal: input.signal ?? new AbortController().signal,
        workingDirectory: input.workdir,
        workspaceRoot: input.workspaceRoot ?? input.workdir,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.maxModelSteps !== undefined ? { maxModelSteps: input.maxModelSteps } : {}),
        ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
      },
      {
        onEvent: async (event) => {
          events.push(event);
          input.onEvent?.(event);
        },
      },
    ),
  };
}

describe("createMuseExecProcessPort", () => {
  it("streams mapped events and returns a clean exit settlement", async () => {
    const ctx = await prepareFixture();
    const { events, run } = runPort({ ...ctx, maxModelSteps: 42 });
    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.surface).toBe("muse-exec");
    expect(result.approvalPosture).toBe("fail-closed");
    // system / result / session_* 等未映射类型必须计数。
    expect(result.unknownEventCount).toBeGreaterThanOrEqual(2);
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("text_delta");
    expect(kinds).toContain("text_end");
    const toolStarted = events.find(
      (event) => event.kind === "tool_activity" && event.status === "started",
    );
    const toolDone = events.find(
      (event) => event.kind === "tool_activity" && event.status === "completed",
    );
    expect(toolStarted?.toolName).toBe("Read");
    expect(toolDone?.toolCallId).toBe(toolStarted?.toolCallId);
    // 提示经 documented --prompt-file 传给 CLI（fixture 截取前 24 字符回显）。
    const text = events
      .filter((event) => event.kind === "text_delta")
      .map((event) => (event.kind === "text_delta" ? event.text : ""))
      .join("");
    expect(text).toContain("Working on: refactor the parser modu");
  });

  it("runs the CLI with the session working directory as cwd", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "write-file" });
    const result = await runPort({ ...ctx }).run;
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(ctx.workdir, "muse-fixture-marker.txt"))).toBe(true);
    expect(await readFile(join(ctx.workdir, "muse-fixture-marker.txt"), "utf8")).toContain(
      "written-by-muse",
    );
  });

  it("rejects before spawn when the working directory escapes the workspace root (R4)", async () => {
    const ctx = await prepareFixture();
    const outside = await mkdtemp(join(tmpdir(), "muse-outside-"));
    cleanups.push(() => rm(outside, { force: true, recursive: true }));
    await expect(
      runPort({ ...ctx, workdir: outside, workspaceRoot: ctx.workdir }).run,
    ).rejects.toThrow(/inside the workspace root/i);
  });

  it("spawns the CLI under the allowlisted environment only (R5)", async () => {
    const ctx = await prepareFixture({
      PATH: process.env.PATH ?? "",
      HOME: "/home/fixture-user",
      MUSE_FIXTURE_MODE: "env-audit",
      // Host 集成凭据：允许清单下绝不进入子进程。
      GITHUB_TOKEN: "ghp_host_secret",
      OPENROUTER_API_KEY: "sk-or-host-secret",
      ZCODE_DESKTOP_SECRET: "host-only-secret",
    });
    const result = await runPort({ ...ctx }).run;
    expect(result.exitCode).toBe(0);
    const envKeys = (
      await readFile(join(ctx.workdir, "muse-fixture-env.txt"), "utf8")
    )
      .split("\n")
      .filter((line) => line.length > 0);
    expect(envKeys).toContain("PATH");
    expect(envKeys).toContain("HOME");
    // MUSE_ 前缀透传（fixture 注入模式自身依赖该约定）。
    expect(envKeys).toContain("MUSE_FIXTURE_MODE");
    expect(envKeys).not.toContain("GITHUB_TOKEN");
    expect(envKeys).not.toContain("OPENROUTER_API_KEY");
    expect(envKeys).not.toContain("ZCODE_DESKTOP_SECRET");
  });

  it("passes the documented unattended approval flag only for the unattended posture (R3)", async () => {
    const unattended = await prepareFixture({ MUSE_FIXTURE_MODE: "argv-audit" });
    const unattendedResult = await runPort({
      ...unattended,
      settings: { ...unattended.settings, approvalPosture: "unattended-sandboxed" },
    }).run;
    expect(unattendedResult.exitCode).toBe(0);
    expect(unattendedResult.approvalPosture).toBe("unattended-sandboxed");
    const unattendedArgv = await readFile(join(unattended.workdir, "muse-fixture-argv.txt"), "utf8");
    expect(unattendedArgv).toContain("--disable-approval");
    expect(unattendedArgv).not.toContain("--yolo");

    const failClosed = await prepareFixture({ MUSE_FIXTURE_MODE: "argv-audit" });
    const failClosedResult = await runPort({ ...failClosed }).run;
    expect(failClosedResult.exitCode).toBe(0);
    const failClosedArgv = await readFile(join(failClosed.workdir, "muse-fixture-argv.txt"), "utf8");
    expect(failClosedArgv).not.toContain("--disable-approval");
    expect(failClosedArgv).not.toContain("--yolo");
  });

  it("captures the muse session id and resumes the documented --session-id on the next turn (R2)", async () => {
    const ctx = await prepareFixture();
    const store = createMemorySessionStore();
    const first = await runPort({ ...ctx, sessionId: "sess_muse_A", sessionStore: store }).run;
    expect(first.museSessionId).toBe("muse-fixture-session-1");
    expect(first.resumedMuseSession).toBe(false);
    expect(store.map()["sess_muse_A"]?.museSessionId).toBe("muse-fixture-session-1");
    expect(store.map()["sess_muse_A"]?.surface).toBe("muse-exec");

    // 第二轮（模拟 MOS 重启后的新端口实例 + 同一持久映射）必须续接同一 muse 会话。
    const audit = await prepareFixture({ MUSE_FIXTURE_MODE: "argv-audit" });
    const storeAfterRestart = createMemorySessionStore(store.map());
    const second = await runPort({
      env: audit.env,
      settings: { ...audit.settings, executablePath: audit.fixturePath },
      workdir: audit.workdir,
      sessionId: "sess_muse_A",
      sessionStore: storeAfterRestart,
    }).run;
    expect(second.resumedMuseSession).toBe(true);
    expect(second.museSessionId).toBe("muse-fixture-session-1");
    const argv = await readFile(join(audit.workdir, "muse-fixture-argv.txt"), "utf8");
    expect(argv).toContain("--session-id");
    expect(argv).toContain("muse-fixture-session-1");
  });

  it("does not pass --session-id when no mapping exists (fresh session)", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "argv-audit" });
    const result = await runPort({ ...ctx }).run;
    expect(result.exitCode).toBe(0);
    expect(result.resumedMuseSession).toBe(false);
    const argv = await readFile(join(ctx.workdir, "muse-fixture-argv.txt"), "utf8");
    expect(argv).not.toContain("--session-id");
  });

  it("surfaces approval requests and user questions as visible events with counts (R3)", async () => {
    const approval = await prepareFixture({ MUSE_FIXTURE_MODE: "approval-event" });
    const approvalRun = runPort({ ...approval });
    const approvalResult = await approvalRun.run;
    expect(approvalResult.exitCode).toBe(0);
    expect(approvalResult.approvalRequestsObserved).toBe(1);
    const approvalEvent = approvalRun.events.find((event) => event.kind === "approval_required");
    expect(approvalEvent && approvalEvent.kind === "approval_required" ? approvalEvent.toolName : "").toBe(
      "Bash",
    );

    const question = await prepareFixture({ MUSE_FIXTURE_MODE: "question-event" });
    const questionRun = runPort({ ...question });
    const questionResult = await questionRun.run;
    expect(questionResult.exitCode).toBe(0);
    expect(questionResult.userQuestionsObserved).toBe(1);
    const questionEvent = questionRun.events.find((event) => event.kind === "user_question");
    expect(
      questionEvent && questionEvent.kind === "user_question" ? questionEvent.summary : "",
    ).toContain("database engine");
  });

  it("rejects with a startup error when the executable cannot start", async () => {
    const ctx = await prepareFixture();
    await expect(
      runPort({ ...ctx, executablePath: join(ctx.workdir, "definitely-missing-muse") }).run,
    ).rejects.toThrow(/failed to start|Failed to launch/i);
  });

  it("surfaces nonzero exit codes with capped stderr instead of swallowing them", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "exit-fail" });
    const result = await runPort({ ...ctx }).run;
    expect(result.exitCode).toBe(3);
    expect(result.stderrTail).toContain("fixture simulated failure detail");
  });

  it("maps in-stream error events so the turn surfaces them as failures", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "error-event" });
    const { events, run } = runPort({ ...ctx });
    const result = await run;
    expect(result.exitCode).toBe(0);
    const errorEvent = events.find((event) => event.kind === "error");
    expect(errorEvent && errorEvent.kind === "error" ? errorEvent.message : "").toContain(
      "fixture runtime error",
    );
  });

  it("counts non-JSON noise lines as unknown events without failing the run", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "invalid" });
    const result = await runPort({ ...ctx }).run;
    expect(result.exitCode).toBe(0);
    expect(result.unknownEventCount).toBeGreaterThanOrEqual(3);
  });

  it("terminates the process tree and reports cancellation on request signal abort", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "hang", MUSE_FIXTURE_DELAY_MS: "5" });
    const controller = new AbortController();
    const { run } = runPort({ ...ctx, signal: controller.signal });
    const settlement = run.then((result) => result);
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort(new Error("user stopped the task"));
    const result = await settlement;
    expect(result.cancelled).toBe(true);
  });

  it("enforces the overall exec timeout and reports timedOut", async () => {
    const ctx = await prepareFixture({ MUSE_FIXTURE_MODE: "hang", MUSE_FIXTURE_DELAY_MS: "5" });
    const result = await runPort({ ...ctx, timeoutMs: 400 }).run;
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  }, 15_000);

  it("returns immediately without spawning when the request signal is already aborted", async () => {
    const ctx = await prepareFixture();
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));
    const result = await runPort({ ...ctx, signal: controller.signal }).run;
    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});

describe("settings handoff", () => {
  it("reads the shared settings file tolerantly and falls back to defaults", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "muse-settings-test-"));
    cleanups.push(() => rm(workdir, { force: true, recursive: true }));
    const settingsPath = join(workdir, "muse-code-backend.json");
    const { readMuseCodeBackendSettings } = await import("../src/muse-code/muse-code-settings.js");
    const env = { ZCODE_MUSE_CODE_SETTINGS_FILE: settingsPath } as NodeJS.ProcessEnv;
    await expect(readMuseCodeBackendSettings(env)).resolves.toEqual(
      DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
    );
    const { writeFile } = await import("node:fs/promises");
    await writeFile(settingsPath, JSON.stringify({ useAsTaskBackend: true, maxModelSteps: 7 }), "utf8");
    await expect(readMuseCodeBackendSettings(env)).resolves.toEqual({
      ...DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
      useAsTaskBackend: true,
      maxModelSteps: 7,
    });
    await writeFile(settingsPath, "{not json", "utf8");
    await expect(readMuseCodeBackendSettings(env)).resolves.toEqual(
      DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
    );
  });
});

beforeEach(() => {
  // mkdtemp in prepareFixture is per-test; nothing global to reset.
  void mkdir;
});
