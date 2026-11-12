// 本地替身 stdio MCP server（contract-only）。
// 只说 MCP 的 newline-delimited JSON-RPC 子集：initialize / tools/list / tools/call / ping。
// 不引入任何 SDK；用于在真实 ZCode MCP 客户端（@zcode/adapters createMcpAdapter）下
// 验证 ProviderPort 端口契约。不是 HubSpot 真实端点的替代证据。
import { createInterface } from "node:readline";

const tools = [
  {
    name: "hubspot_search_contacts",
    description:
      "Stand-in read tool for contract-level provider evidence (no real HubSpot access).",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
];

const write = (message) => {
  process.stdout.write(JSON.stringify(message) + "\n");
};

const handlers = {
  initialize: (request) => {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "standin-hubspot", version: "0.1.0" },
      },
    });
  },
  "tools/list": (request) => {
    write({ jsonrpc: "2.0", id: request.id, result: { tools } });
  },
  "tools/call": (request) => {
    const args = request.params?.arguments ?? {};
    if (args.__simulate === "expired") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: "HTTP 401: token expired or revoked" }],
          isError: true,
        },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          { type: "text", text: JSON.stringify({ records: [], query: args.query ?? null }) },
        ],
        isError: false,
      },
    });
  },
  ping: (request) => {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
  },
};

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.method === "notifications/initialized") return;
  handlers[message.method]?.(message);
});
