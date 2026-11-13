// SessionStart hook 契约镜像（packages/mos-studio/src/contract/hook-payload.ts +
// src/hook/main-hook.ts）：
// - stdin 投递单段 JSON（camelCase 主契约 + snake_case 兼容别名）；
// - hook 任何路径都 exit 0（graceful failure；hooks.json onError=allow 双保险）；
// - 结果 JSON 行写 stderr：{ hook: "mos-studio", outcome, sessionId, ... }，
//   outcome ∈ mission_created | skipped | sidecar_error | timeout；
// - 干净机器上未注入 ZCODE_PLUGIN_DATA 时 source=startup 会以 sidecar_error 落定（仍 exit 0）。
//
// 运行方式（干净机器验收的关键）：严格按 seed 后 hooks.json 里的命令字符串经 shell 执行
// （unix `sh -c`，Windows `cmd /c`）——命令里只有应用自带 Electron（ELECTRON_RUN_AS_NODE=1），
// 没有系统 node。
import { spawn } from "node:child_process";

export const HOOK_OUTCOMES = ["mission_created", "skipped", "sidecar_error", "timeout"];
export const SESSION_START_SOURCE_STARTUP = "startup";

/**
 * 构造 SessionStart hook 的 stdin payload（与真实投递形状一致）。
 */
export function buildSessionStartHookPayload({
  sessionId,
  cwd,
  timestamp = new Date().toISOString(),
  source = SESSION_START_SOURCE_STARTUP,
}) {
  return {
    hookEventName: "SessionStart",
    sessionId,
    cwd,
    timestamp,
    source,
    session_id: sessionId,
    hook_event_name: "SessionStart",
  };
}

/**
 * hook 命令的 shell 执行封装：unix 用 sh -c，Windows 用 cmd /c。
 * 命令字符串原样透传（不做任何转义/改写）。
 */
export function buildHookInvocation(platformKey, commandString) {
  if (platformKey.startsWith("win")) {
    return { shell: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandString] };
  }
  return { shell: "/bin/sh", args: ["-c", commandString] };
}

/** 解析 hook stderr 中的结果 JSON 行（{hook:"mos-studio", outcome, ...}）。 */
export function parseHookOutcomeLine(stderrText) {
  for (const line of String(stderrText).split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object" && value.hook === "mos-studio") return value;
    } catch {
      // 非结果行，继续找。
    }
  }
  return null;
}

/**
 * 执行 seed 后的 SessionStart hook 命令（经 shell，stdin 投递 payload）。
 * 返回 { code, stdout, stderr, outcome, timedOut }，不抛错。
 *
 * @param {{ platformKey: string, command: string, payload: object, cwd?: string,
 *           env?: Record<string,string|undefined>, timeoutMs?: number }} input
 */
export function runSessionStartHookCommand({
  platformKey,
  command,
  payload,
  cwd,
  env,
  timeoutMs = 60_000,
}) {
  const { shell, args } = buildHookInvocation(platformKey, command);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(shell, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsVerbatimArguments: platformKey.startsWith("win"),
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        outcome: null,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.slice(-64_000),
        stderr: stderr.slice(-64_000),
        outcome: parseHookOutcomeLine(stderr),
        timedOut,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {});
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}
