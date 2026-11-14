import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type {
  MuseExecutionPort,
  MuseExecHandlers,
  MuseExecRequest,
  MuseExecRunResult,
  MuseExecStreamEvent,
} from "@zcode/contracts";
import {
  DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS,
  type MuseCodeBackendSettings,
} from "@zcode/shared";
import { parseMuseExecJsonlLine } from "./muse-exec-jsonl.js";
import { readMuseCodeBackendSettings } from "./muse-code-settings.js";
// Muse Code CLI 子进程执行端口（Issue #24 / ACR-0002）。
//
// 进程纪律（对齐 services/zcode-agent/zcodeStdioTransport.ts 的收口语义，CLI 进程内自持有）：
// - 绝不 shell:true；显式 argv；Windows 上不 spawn .cmd/.bat shim（CVE 修复后 Node
//   拒绝无 shell 的 .cmd，MOS 也不为此打开 shell），只支持可执行文件，用户可在
//   设置里填绝对路径覆盖。
// - cwd 固定为会话工作目录（工作区约束边界）；stdin 忽略，提示经 documented
//   `--prompt-file` 临时文件传入，避免 argv 长度/转义问题。
// - abort/超时 → 进程树终止（POSIX 进程组 SIGTERM→SIGKILL；Windows taskkill /T /F）。
// - stderr 只保留尾部 64KB 诊断窗口；stdout 逐行 JSONL，超长行按 unknown 计数。

const STDERR_LIMIT = 64 * 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const TREE_FORCE_AFTER_MS = 5_000;
const MUSE_EXECUTABLE_ENV = "ZCODE_MUSE_EXECUTABLE";

export interface MuseExecProcessDeps {
  env?: NodeJS.ProcessEnv;
  /** 测试注入：覆盖设置读取。 */
  readSettings?: (env: NodeJS.ProcessEnv) => Promise<MuseCodeBackendSettings>;
  /** 测试注入：覆盖可执行入口解析。 */
  resolveExecutable?: (env: NodeJS.ProcessEnv, settings: MuseCodeBackendSettings) => string;
}

class MuseExecStartupError extends Error {
  constructor(
    readonly issueCode: "executableNotFound" | "spawnFailed",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MuseExecStartupError";
  }
}

export function createMuseExecutionPort(deps: MuseExecProcessDeps = {}): MuseExecutionPort {
  const env = deps.env ?? process.env;
  const readSettings = deps.readSettings ?? readMuseCodeBackendSettings;
  const resolveExecutable =
    deps.resolveExecutable ??
    ((envValue: NodeJS.ProcessEnv, settings: MuseCodeBackendSettings) =>
      resolveDefaultMuseExecutable(envValue, settings));

  return {
    async runMuseExec(
      request: MuseExecRequest,
      handlers: MuseExecHandlers,
    ): Promise<MuseExecRunResult> {
      const settings = await readSettings(env);
      const executable = request.executablePath ?? resolveExecutable(env, settings);
      if (isAbsolute(executable)) {
        return runMuseExecChild(executable, request, settings, handlers, env);
      }
      if (process.platform === "win32") {
        const resolved = resolveOnWindowsPath(env, executable);
        if (!resolved) {
          throw new MuseExecStartupError(
            "executableNotFound",
            `Muse Code CLI executable "${executable}" was not found on PATH. Install the CLI or set an absolute executable path in MOS Model Settings.`,
          );
        }
        return runMuseExecChild(resolved, request, settings, handlers, env);
      }
      return runMuseExecChild(executable, request, settings, handlers, env);
    },
  };
}

async function runMuseExecChild(
  executable: string,
  request: MuseExecRequest,
  settings: MuseCodeBackendSettings,
  handlers: MuseExecHandlers,
  spawnEnv: NodeJS.ProcessEnv,
): Promise<MuseExecRunResult> {
  const timeoutMs =
    request.timeoutMs && request.timeoutMs > 0
      ? request.timeoutMs
      : settings.timeoutMs && settings.timeoutMs > 0
        ? settings.timeoutMs
        : DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS;
  const maxModelSteps = request.maxModelSteps ?? settings.maxModelSteps;
  const promptDir = join(tmpdir(), `mos-muse-${crypto.randomUUID().slice(0, 8)}`);
  const promptFile = join(promptDir, "prompt.txt");
  let child: ReturnType<typeof spawn> | undefined;
  let timedOut = false;
  let cancelled = false;
  let unknownEventCount = 0;
  let stderr = "";
  let toolEventSeq = 0;
  const activeToolIdsByName = new Map<string, string>();
  const pending = new Set<Promise<void>>();

  /** muse 工具事件缺 id 时合成稳定关联 id（同工具名的 started→completed 配对）。 */
  const synthesizeToolCallIds = (event: MuseExecStreamEvent): MuseExecStreamEvent => {
    if (event.kind !== "tool_activity") return event;
    if (event.toolCallId && event.toolCallId.length > 0) return event;
    toolEventSeq += 1;
    if (event.status === "started") {
      const id = `muse:${event.toolName}:${toolEventSeq}`;
      activeToolIdsByName.set(event.toolName, id);
      return { ...event, toolCallId: id };
    }
    const activeId = activeToolIdsByName.get(event.toolName);
    activeToolIdsByName.delete(event.toolName);
    return { ...event, toolCallId: activeId ?? `muse:${event.toolName}:${toolEventSeq}` };
  };

  const combinedSignal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const onCombinedAbort = () => {
    if (request.signal.aborted) {
      cancelled = true;
    } else {
      timedOut = true;
    }
    terminateChildTree(child);
  };
  combinedSignal.addEventListener("abort", onCombinedAbort, { once: true });
  if (combinedSignal.aborted) {
    // 进入时已取消/超时：不再 spawn，直接返回取消事实，由调用方裁决。
    combinedSignal.removeEventListener("abort", onCombinedAbort);
    return {
      cancelled: request.signal.aborted,
      exitCode: null,
      stderrTail: "",
      timedOut: !request.signal.aborted,
      unknownEventCount: 0,
    };
  }

  try {
    await mkdir(promptDir, { recursive: true });
    await writeFile(promptFile, request.prompt, "utf8");
    const args = [
      "exec",
      "--json",
      "--prompt-file",
      promptFile,
      ...(maxModelSteps !== undefined ? ["--max-model-steps", String(maxModelSteps)] : []),
    ];
    try {
      child = spawn(executable, args, {
        cwd: request.workingDirectory,
        detached: process.platform !== "win32",
        // 子进程继承装配 env（create-app options.env；缺省 = 本进程环境）：
        // muse CLI 的自身登录态在其自己的配置目录里，不需要 MOS 传递任何凭据。
        env: spawnEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new MuseExecStartupError(
        "spawnFailed",
        `Failed to launch Muse Code CLI at ${executable}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (child.pid === undefined || !child.stdout || !child.stderr) {
      // ENOENT 等异步 spawn 错误：必须先挂 error 监听再抛，否则事件无监听升级为 uncaught。
      child.once("error", () => undefined);
      throw new MuseExecStartupError(
        "spawnFailed",
        `Failed to launch Muse Code CLI at ${executable} (process did not start)`,
      );
    }

    const dispatchLine = async (line: string): Promise<void> => {
      if (combinedSignal.aborted) return;
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        unknownEventCount += 1;
        return;
      }
      const parsed = parseMuseExecJsonlLine(line);
      if (parsed.status === "empty") return;
      if (parsed.status === "unknown" || parsed.status === "invalid") {
        unknownEventCount += 1;
        return;
      }
      await handlers.onEvent(synthesizeToolCallIds(parsed.event));
    };

    let dispatchFailure: unknown;
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      const handling = dispatchLine(line).catch((error: unknown) => {
        // handler 抛错（含取消）：终止子进程并让错误冒泡为本 run 的失败。
        terminateChildTree(child);
        dispatchFailure ??= error;
      });
      pending.add(handling);
      void handling.finally(() => pending.delete(handling));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = trimStderr(stderr + chunk.toString("utf8"));
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.once("error", (error: Error) => {
        reject(
          new MuseExecStartupError(
            "spawnFailed",
            `Muse Code CLI at ${executable} failed to start: ${error.message}`,
            { cause: error },
          ),
        );
      });
      child!.once("close", (code) => resolve(code));
    });
    reader.close();
    // 子进程退出后，先前派发的事件仍在飞；全部收口再返回。
    while (pending.size > 0) await Promise.allSettled(pending);
    if (dispatchFailure !== undefined) throw dispatchFailure;
    return {
      cancelled,
      exitCode,
      stderrTail: stderr,
      timedOut,
      unknownEventCount,
    };
  } finally {
    combinedSignal.removeEventListener("abort", onCombinedAbort);
    terminateChildTree(child);
    while (pending.size > 0) await Promise.allSettled(pending);
    await rm(promptDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

function resolveDefaultMuseExecutable(
  env: NodeJS.ProcessEnv,
  settings: MuseCodeBackendSettings,
): string {
  const override = env[MUSE_EXECUTABLE_ENV]?.trim();
  if (override && override.length > 0) return override;
  return settings.executablePath?.trim() || "muse";
}

/**
 * Windows PATH 解析：只接受可直接 spawn 的可执行文件（.exe/.com）。
 * .cmd/.bat npm shim 需要经 cmd.exe 解析，MOS 不为其打开 shell；
 * 用户可把绝对路径（原生安装的 muse.exe 或 shim 的真实目标）填进设置。
 */
function resolveOnWindowsPath(env: NodeJS.ProcessEnv, command: string): string | null {
  const pathDirs = (env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);
  for (const dir of pathDirs) {
    for (const candidate of [`${command}.exe`, `${command}.com`]) {
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

function terminateChildTree(child: ReturnType<typeof spawn> | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (typeof pid !== "number") {
    // 从未拿到 pid（spawn ENOENT 等）：没有可终止的进程；再 kill 只会二次抛错。
    return;
  }
  if (process.platform === "win32") {
    // taskkill 是可执行文件直调（无 shell）；/T 覆盖子树，/F 强制。
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child?.kill());
    return;
  }
  try {
    // detached spawn 建立了独立进程组；kill(-pid) 覆盖整组后代。
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceTimer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, TREE_FORCE_AFTER_MS);
  forceTimer.unref?.();
}

function trimStderr(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= STDERR_LIMIT) return value;
  return value.slice(-STDERR_LIMIT);
}
