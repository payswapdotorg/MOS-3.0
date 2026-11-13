// MCP stdio 握手客户端（仅 node 内建）：release-smoke 在干净目标机上不依赖
// @modelcontextprotocol/sdk —— 目标机只有安装出来的应用与系统 Node（冒烟脚本自身）。
//
// 协议事实（packages/mos-studio/src/runtime/main.ts + src/server/studio-server.ts，
// server 由 @modelcontextprotocol/sdk 1.29.0 的 StdioServerTransport 驱动）：
// - 传输为 ndjson：每条 JSON-RPC 消息一行；
// - 握手序列：客户端 `initialize` 请求 → 等 id 响应 → 发 `notifications/initialized`
//   通知 → `tools/list` / `tools/call` 请求；
// - protocolVersion "2025-06-18" 在 SDK 1.29.0 的支持集内
//   （SUPPORTED_PROTOCOL_VERSIONS = 2025-11-25 / 2025-06-18 / 2025-03-26 /
//   2024-11-05 / 2024-10-07）；
// - 工具名 mos_studio_status（contract/studio-vocabulary.ts MOS_STUDIO_STATUS_TOOL），
//   无会话 _meta 时安全降级（availability.reason=session_context_unavailable）。
import { spawn } from "node:child_process";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];
export const MCP_HANDSHAKE_CLIENT_INFO = { name: "mos-release-smoke", version: "1.0.0" };

/** JSON-RPC 请求帧（对象）。 */
export function jsonRpcRequest(id, method, params = {}) {
  return { jsonrpc: "2.0", id, method, params };
}

/** JSON-RPC 通知帧（无 id，无需响应）。 */
export function jsonRpcNotification(method, params = {}) {
  return { jsonrpc: "2.0", method, params };
}

/** 编码为一行 ndjson（发送用）。 */
export function encodeFrame(message) {
  return `${JSON.stringify(message)}\n`;
}

export function buildInitializeRequest(id, { protocolVersion = MCP_PROTOCOL_VERSION, clientInfo = MCP_HANDSHAKE_CLIENT_INFO } = {}) {
  return jsonRpcRequest(id, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo,
  });
}

export function buildInitializedNotification() {
  return jsonRpcNotification("notifications/initialized");
}

export function buildToolsListRequest(id) {
  return jsonRpcRequest(id, "tools/list");
}

export function buildToolsCallRequest(id, name, args = {}) {
  return jsonRpcRequest(id, "tools/call", { name, arguments: args });
}

/** 解析一行 ndjson；非法 JSON 返回 null（记录为原始行，不中断握手）。 */
export function parseJsonRpcLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const value = JSON.parse(trimmed);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/**
 * 与 stdio MCP server 完成完整握手：initialize → initialized 通知 → tools/list →
 * tools/call（mos_studio_status）。任何阶段失败都如实返回（不抛错），由调用方记为
 * 证据里的 failed/degraded。
 *
 * @param {{ command: string, args: string[], env?: Record<string,string|undefined>,
 *           cwd?: string, toolName?: string, requestTimeoutMs?: number,
 *           bootTimeoutMs?: number, onRawLine?: (line: string) => void }} input
 * @returns {Promise<{ ok: boolean, stage: string, error?: string, protocolVersion?: string,
 *                     serverInfo?: unknown, tools?: string[], toolCall?: object,
 *                     transcript: string[] }>}
 */
export async function runMcpHandshake({
  command,
  args,
  env,
  cwd,
  toolName = "mos_studio_status",
  requestTimeoutMs = 45_000,
  bootTimeoutMs = 45_000,
  onRawLine,
}) {
  const transcript = [];
  /** @type {Array<(message: object) => void>} */
  const waiters = [];
  const pushMessage = (message) => {
    for (const waiter of waiters.splice(0)) waiter(message);
  };

  const result = {
    ok: false,
    stage: "spawn",
    protocolVersion: undefined,
    serverInfo: undefined,
    tools: undefined,
    toolCall: undefined,
    transcript,
  };

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (transcript.length < 200) transcript.push(line);
      onRawLine?.(line);
      const message = parseJsonRpcLine(line);
      if (message) pushMessage(message);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (transcript.length < 200) transcript.push(`[stderr] ${text.trim()}`);
    stderrTail = `${stderrTail}${text}`.slice(-4000);
  });

  const childClosed = new Promise((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", (error) => resolve(error instanceof Error ? error.message : String(error)));
  });

  const send = (message) => {
    child.stdin.write(encodeFrame(message));
  };

  const waitForResponse = (id, timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待 JSON-RPC 响应 id=${id} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      const waiter = (message) => {
        if (typeof message.id !== "undefined" && message.id === id && typeof message.result !== "undefined") {
          clearTimeout(timer);
          resolve(message);
        } else {
          waiters.push(waiter);
        }
      };
      waiters.push(waiter);
    });

  const closeChild = () => {
    try {
      child.stdin.end();
    } catch {
      // 进程可能已退出。
    }
    setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // 已退出。
      }
    }, 500).unref();
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 已退出。
      }
    }, 5000).unref();
  };

  try {
    // 1) initialize 请求（server 启动 + 原生模块加载都在这一步暴露）。
    send(buildInitializeRequest(1));
    const initializeResponse = await waitForResponse(1, bootTimeoutMs);
    result.stage = "initialized";
    result.protocolVersion = initializeResponse.result?.protocolVersion;
    result.serverInfo = initializeResponse.result?.serverInfo;
    if (
      typeof result.protocolVersion !== "string" ||
      !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)
    ) {
      result.error = `server 返回了未知 protocolVersion：${String(result.protocolVersion)}`;
      return result;
    }

    // 2) initialized 通知（MCP 握手必需，SDK server 在此之前不接受业务请求）。
    send(buildInitializedNotification());

    // 3) tools/list：确认 mos_studio_status 在列。
    send(buildToolsListRequest(2));
    const toolsResponse = await waitForResponse(2, requestTimeoutMs);
    result.stage = "tools-list";
    result.tools = (toolsResponse.result?.tools ?? []).map((tool) => tool?.name).filter(Boolean);
    if (!result.tools.includes(toolName)) {
      result.error = `tools/list 未包含 ${toolName}（实际：${result.tools.join(", ") || "空"}）`;
      return result;
    }

    // 4) tools/call mos_studio_status {}：无 provider 连接时的安全降级即通过。
    send(buildToolsCallRequest(3, toolName, {}));
    const toolCallResponse = await waitForResponse(3, requestTimeoutMs);
    result.stage = "tools-call";
    result.toolCall = toolCallResponse.result;
    if (toolCallResponse.result?.isError === true) {
      result.error = `${toolName} 返回 isError=true`;
      return result;
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = `${error instanceof Error ? error.message : String(error)}${stderrTail ? `；stderr 尾部：${stderrTail.slice(-1500)}` : ""}`;
    return result;
  } finally {
    closeChild();
    await Promise.race([childClosed, new Promise((resolve) => setTimeout(resolve, 6000))]);
  }
}
