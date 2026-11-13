// 子进程运行原语：run-and-capture（带超时/输入/输出封顶）与 commandExists。
// 冒烟脚本不直接用 child_process.exec*：要拿到稳定的超时杀死与输出证据。
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * 运行命令并捕获输出。永不 reject（spawn ENOENT 折算为 { code: null, error }），
 * 让调用方把失败记成证据而不是让证据半途丢失。
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string|undefined>, input?: string,
 *           timeoutMs?: number, maxOutputBytes?: number }} [options]
 * @returns {Promise<{ command: string, args: string[], code: number | null, stdout: string, stderr: string, timedOut: boolean, error?: string }>}
 */
export function runCapture(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        command,
        args,
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let stdoutClamped = false;
    let stderrClamped = false;
    let timedOut = false;
    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        code,
        stdout: stdoutClamped ? `${stdout}\n[clamped]` : stdout,
        stderr: stderrClamped ? `${stderr}\n[clamped]` : stderr,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // SIGKILL 后再兜底一次强杀（Windows 上 SIGKILL 等价 TerminateProcess）。
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 进程已退出。
        }
      }, 2000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxOutputBytes) stdout += String(chunk);
      else stdoutClamped = true;
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxOutputBytes) stderr += String(chunk);
      else stderrClamped = true;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command,
        args,
        code: null,
        stdout,
        stderr,
        timedOut,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (code) => finish(code));

    if (options.input !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

/** 命令是否可用（which/where；找不到返回 false 而不是抛错）。 */
export async function commandExists(command, platform = process.platform) {
  const lookup = platform === "win32" ? "where" : "which";
  const result = await runCapture(lookup, [command], { timeoutMs: 15_000 });
  return result.code === 0 && result.stdout.trim().length > 0;
}

/** 路径可执行性探测（bin 目录下按平台扩展名查找，返回第一个存在的绝对路径或 null）。 */
export async function firstExistingBinary(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // 继续找下一个候选。
    }
  }
  return null;
}
