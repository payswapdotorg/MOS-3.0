// 本地替身：Composio session 工厂 + session MCP（contract-only，绝不作为真实 provider 证据）。
// - POST /session：校验 x-api-key（401 fail-closed），返回 {session_id, mcp:{type,url}}，
//   mcp.url 指回本进程的 /mcp（standin session MCP，streamable HTTP 子集）。
// - /mcp：initialize / notifications / tools/list / tools/call（COMPOSIO_MULTI_EXECUTE_TOOL →
//   HACKERNEWS_SEARCH_POSTS 形状的 counts-only 替身结果）。
// 与 zcode-mos-adapters 的 standin-http-mcp-server.mjs 同语义级别（真实 ZCode MCP 客户端
// http transport + x-api-key header 透传验证）。
import { createServer } from "node:http";

const EXPECTED_API_KEY = process.env.STANDIN_COMPOSIO_API_KEY ?? "standin-composio-key";
const SESSION_ID = "standin-composio-session-1";

function sseBody(message) {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  try {
    if (url === "/session" && request.method === "POST") {
      if (request.headers["x-api-key"] !== EXPECTED_API_KEY) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          session_id: SESSION_ID,
          mcp: { type: "http", url: `http://127.0.0.1:${server.address().port}/mcp` },
        }),
      );
      return;
    }
    if (url === "/mcp") {
      if (request.headers["x-api-key"] !== EXPECTED_API_KEY) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const body = await readBody(request);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: -32700, message: "Parse error" } }));
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      let result;
      if (message.method === "initialize") {
        result = {
          protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "standin-composio-session", version: "0.1.0" },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "COMPOSIO_MULTI_EXECUTE_TOOL",
              description: "Stand-in composio session meta-tool.",
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
              annotations: { readOnlyHint: false },
            },
          ],
        };
      } else if (message.method === "tools/call") {
        const args = message.params?.arguments ?? {};
        void args;
        // 与真实 Composio MULTI_EXECUTE 同款文本形状：{successful, data:{results:[...], total_count,
        // success_count, error_count}, log_id}（counts only 替身记录，绝不作为真实 provider 证据）。
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                successful: true,
                data: {
                  results: [
                    { response: { id: "hit-1" }, tool_slug: "HACKERNEWS_SEARCH_POSTS", index: 0 },
                    { response: { id: "hit-2" }, tool_slug: "HACKERNEWS_SEARCH_POSTS", index: 1 },
                  ],
                  total_count: 2,
                  success_count: 2,
                  error_count: 0,
                },
                error: {},
                log_id: "standin-log-1",
              }),
            },
          ],
          isError: false,
        };
      } else {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: -32601, message: "Method not found" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(sseBody({ jsonrpc: "2.0", id: message.id, result }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: String(error) }));
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`${address.port}\n`);
});
