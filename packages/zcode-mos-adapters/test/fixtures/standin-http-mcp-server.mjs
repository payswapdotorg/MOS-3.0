// 本地替身 streamable HTTP MCP server（contract-only）。
// 说 MCP streamable HTTP 子集：initialize / notifications / tools/list / tools/call。
// 与 stdio 替身的差异：校验 x-api-key header（401 fail-closed），用于验证
// ProviderPort http 配置的 headers 透传（授权材料运行时注入 → ZCode MCP 客户端
// requestInit.headers）。不是任何真实 provider 端点的替代证据。
import { createServer } from "node:http";

const EXPECTED_API_KEY = process.env.STANDIN_HTTP_API_KEY ?? "standin-test-key";
const SESSION_ID = "standin-session-1";

const tools = [
  {
    name: "http_echo_read",
    description: "Stand-in http read tool for header-passthrough contract evidence.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
];

function sseBody(message) {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function handle(request, response, body) {
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
      serverInfo: { name: "standin-http", version: "0.1.0" },
    };
  } else if (message.method === "tools/list") {
    result = { tools };
  } else if (message.method === "tools/call") {
    const args = message.params?.arguments ?? {};
    result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ records: [], query: args.query ?? null }),
        },
      ],
      isError: false,
    };
  } else if (message.method === "ping") {
    result = {};
  } else {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: { code: -32601, message: `Method not found: ${message.method}` },
      }),
    );
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Mcp-Session-Id": SESSION_ID,
  });
  response.end(sseBody({ jsonrpc: "2.0", id: message.id, result }));
}

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405);
    response.end();
    return;
  }
  // fail-closed：授权 header 缺失/不匹配 → 401（不进入协议处理）。
  if (request.headers["x-api-key"] !== EXPECTED_API_KEY) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { code: 401, message: "Unauthorized" } }));
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => handle(request, response, body));
});

const port = Number(process.env.STANDIN_HTTP_PORT ?? 0);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`${server.address().port}\n`);
});
