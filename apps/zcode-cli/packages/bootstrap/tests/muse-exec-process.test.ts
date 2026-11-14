import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MuseExecStreamEvent } from "@zcode/contracts";
import type { MuseCodeBackendSettings } from "@zcode/shared";
import { DEFAULT_MUSE_CODE_BACKEND_SETTINGS } from "@zcode/shared";
import { createMuseExecutionPort } from "../src/muse-code/muse-exec-process.js";
// muse exec 子进程端口的契约测试（Issue #24 / ACR-0002）：
// 用 mock CLI（fixtures/muse-code/mock-muse-cli.mjs）验证 spawn/流式/取消/超时/退出码语义。
// 这是 mock 契约证据，不是真实 Meta CLI 的执行证据（AGENTS.md §7：contract-tested）。

const FIXTURE_URL = new URL("./fixtures/muse-code/mock-muse-cli.mjs", import.meta.url);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

async function prepareFixture(env: NodeJS.ProcessEnv = {}): Promise<{
  env: NodeJS.ProcessEnv;
  settings: MuseCodeBackendSettings;
  workdir: string;
}> {
  const workdir = await mkdtemp(join(tmpdir(), "muse-exec-test-"));
  cleanups.push(() => rm(workdir, { force: true, recursive: true }));
  const fixtureCopy = join(workdir, "mock-muse-cli.mjs");
  await copyFile(fileURLToPath(FIXTURE_URL), fixtureCopy);
  await chmod(fixtureCopy, 0o755);
  return {
    env,
    settings: { ...DEFAULT_MUSE_CODE_BACKEND_SETTINGS },
    workdir,
  };
}

function runPort(input: {
  env: NodeJS.ProcessEnv;
  settings: MuseCodeBackendSettings;
  workdir: string;
  prompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxModelSteps?: number;
  executablePath?: string;
  onEvent?: (event: MuseExecStreamEvent) => void;
}) {
  const port = createMuseExecutionPort({
    env: input.env,
    readSettings: async () => input.settings,
    // 绝对路径直连 mock fixture（不依赖 PATH；Windows 由在机验证覆盖）。
    resolveExecutable: () => join(input.workdir, "mock-muse-cli.mjs"),
  });
  const events: MuseExecStreamEvent[] = [];
  return {
    events,
    run: port.runMuseExec(
      {
        prompt: input.prompt ?? "refactor the parser module",
        signal: input.signal ?? new AbortController().signal,
        workingDirectory: input.workdir,
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

describe("createMuseExecutionPort", () => {
  it("streams mapped events and returns a clean exit settlement", async () => {
    const ctx = await prepareFixture();
    const { events, run } = runPort({ ...ctx, maxModelSteps: 42 });
    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
    // system / result 两个未映射类型必须计数。
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
