/**
 * Live 集成测试：真实 Composio hosted session MCP + 真实 ZCode MCP 客户端栈 + 真实凭据存储。
 *
 * 这是 W1 账本两项开放条目的关闭证据（Real provider account connected /
 * Real provider read operation verified，provider=composio）：
 *   1) 真实 provider 账号凭据（COMPOSIO_API_KEY，仅存在于环境/凭据存储，绝不进入源码、
 *      日志或断言输出）经 REST session 工厂签发真实 hosted session MCP endpoint；
 *   2) 真实 ZCode MCP 客户端（createMcpAdapter http transport + x-api-key header，
 *      header 值从真实加密凭据存储读回）连接该 endpoint；
 *   3) tools/list 枚举真实 meta-tool 名；COMPOSIO_MULTI_EXECUTE_TOOL 执行一次真实
 *      外部数据读（Hacker News 搜索，no-auth toolkit）；
 *   4) 负向矩阵：无效 key 的 http 连接 fail-closed（401 → status=failed）。
 *
 * 运行前提（与 mcp-real-stack.test.ts 同约定，dist 依赖，不进 engineering 列表）：
 *   pnpm --filter @zcode/adapters... build
 *   COMPOSIO_API_KEY=<key> pnpm --filter @mos/adapters test
 * 无 COMPOSIO_API_KEY 时整个 describe 跳过（skip 语义，绝不伪造通过）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createMcpAdapter,
  createSharedZCodeCredentialStore,
} from "@zcode/adapters";
import type { McpPort } from "@zcode/contracts";
import {
  parseProviderToolName,
  toProviderToolName,
  type ProviderPort,
  type ProviderServerConfig,
  type ProviderServerState,
} from "../../src/index.js";

const API_KEY_ENV = "COMPOSIO_API_KEY";
/** REST session 工厂（provider 文档化 endpoint；与 @mos/integrations 描述符数据一致）。 */
const SESSION_FACTORY_URL = "https://backend.composio.dev/api/v3.1/tool_router/session";
/** no-auth toolkit（真实外部数据读的最小面；避免需要任何用户 OAuth 连接）。 */
const SESSION_TOOLKITS = ["hackernews"];
const MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
const SEARCH_TOOLS_TOOL = "COMPOSIO_SEARCH_TOOLS";
const GET_TOOL_SCHEMAS_TOOL = "COMPOSIO_GET_TOOL_SCHEMAS";
const READ_TOOL_SLUG = "HACKERNEWS_SEARCH_POSTS";
/** 凭据存储键（不透明引用；值 = x-api-key header 材料）。 */
const CREDENTIAL_KEY = "mcp:apikey:composio-live-verify:header";

const apiKey = process.env[API_KEY_ENV] ?? "";
const liveSuite = apiKey.length > 0 ? describe : describe.skip;

const sessionResponseSchema = z.object({
  session_id: z.string().min(1),
  mcp: z.object({ type: z.string().min(1), url: z.string().url() }),
});

/** 真实 session 工厂调用（provider I/O；仅限集成测试，绝不进入生产域代码）。 */
async function createLiveSession(): Promise<{ sessionId: string; mcpUrl: string }> {
  const response = await fetch(SESSION_FACTORY_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: "mos-live-verify",
      mcp: true,
      toolkits: { enable: [...SESSION_TOOLKITS] },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  // session 工厂是 POST create：201 Created（成功创建）或 200（幂等复用）都算成功。
  expect(
    response.status === 200 || response.status === 201,
    `session factory returned ${response.status}`,
  ).toBe(true);
  const parsed = sessionResponseSchema.parse(await response.json());
  return { sessionId: parsed.session_id, mcpUrl: parsed.mcp.url };
}

/**
 * 测试本地组合（与 mcp-real-stack.test.ts 相同的生产组合根形状）：
 * ProviderPort → 真实 McpPort；http/sse 配置透传 headers（授权材料运行时注入）。
 */
function providerPortOverMcp(mcp: McpPort): ProviderPort {
  const toConfig = (config: ProviderServerConfig) => {
    if (config.kind === "stdio") {
      return {
        type: "stdio" as const,
        command: config.command,
        ...(config.args ? { args: [...config.args] } : {}),
        ...(config.env ? { env: { ...config.env } } : {}),
      };
    }
    return {
      type: config.kind,
      url: config.url,
      ...(config.headers ? { headers: { ...config.headers } } : {}),
    };
  };
  return {
    async connectServer(name, config) {
      const status = await mcp.connectServer(name, toConfig(config), {});
      return {
        status: status.status,
        error: status.error ?? null,
        toolCount: status.toolCount ?? null,
      };
    },
    async listTools() {
      const tools = await mcp.listTools();
      return tools.map((tool) => ({
        serverName: tool.serverName,
        toolName: tool.toolName,
        canonicalName: tool.name ?? toProviderToolName(tool.serverName, tool.toolName),
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? null,
        annotations: null,
      }));
    },
    async callTool(request) {
      const result = await mcp.callTool({
        serverName: request.serverName,
        toolName: request.toolName,
        ...(request.arguments ? { arguments: request.arguments } : {}),
        ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      });
      return {
        content: [...(result.content ?? [])],
        isError: result.isError === true,
        structuredContent: result.structuredContent ?? null,
      };
    },
    async status(): Promise<Record<string, ProviderServerState>> {
      const statuses = await mcp.status();
      const mapped: Record<string, ProviderServerState> = {};
      for (const [name, state] of Object.entries(statuses)) {
        mapped[name] = {
          status: state.status,
          error: state.error ?? null,
          toolCount: state.toolCount ?? null,
        };
      }
      return mapped;
    },
    async close() {
      return mcp.close();
    },
  };
}

const ports: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const port of ports.splice(0)) await port.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** 断言只看计数/形状；绝不把 provider 原始 payload 或 key 材料写进测试输出。 */
function parseExecuteText(content: readonly { type?: string; text?: string }[]): unknown {
  const text = content.find((block) => typeof block.text === "string")?.text;
  expect(text).toBeDefined();
  return JSON.parse(text as string);
}

liveSuite("real Composio hosted session MCP over the real ZCode MCP client stack", () => {
  test(
    "session factory issues a real hosted MCP session",
    async () => {
      const session = await createLiveSession();
      expect(session.sessionId).toMatch(/^trs_/);
      expect(session.mcpUrl).toContain("backend.composio.dev/tool_router/");
      expect(session.mcpUrl).toContain(session.sessionId);
    },
    60_000,
  );

  test(
    "credential chain: key round-trips the real encrypted store and connects the session MCP",
    async () => {
      const session = await createLiveSession();
      // 真实凭据链：env → 真实加密存储（不透明引用）→ 运行时读回作为 header 材料。
      const dir = await mkdtemp(join(tmpdir(), "mos-composio-live-"));
      tempDirs.push(dir);
      const store = createSharedZCodeCredentialStore({
        filePath: join(dir, "credentials.json"),
      });
      await store.save(CREDENTIAL_KEY, apiKey);
      const injectedHeader = await store.load(CREDENTIAL_KEY);
      expect(injectedHeader).toBe(apiKey);

      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.2.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      const state = await provider.connectServer("composio-session", {
        kind: "http",
        url: session.mcpUrl,
        headers: { "x-api-key": injectedHeader as string },
      });
      expect(state.status).toBe("connected");
      const status = await provider.status();
      expect(status["composio-session"]?.status).toBe("connected");
    },
    90_000,
  );

  test(
    "listTools enumerates the real session meta-tools",
    async () => {
      const session = await createLiveSession();
      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.2.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      const state = await provider.connectServer("composio-session", {
        kind: "http",
        url: session.mcpUrl,
        headers: { "x-api-key": apiKey },
      });
      expect(state.status).toBe("connected");

      const tools = await provider.listTools();
      const names = tools.map((tool) => tool.toolName);
      // 已核实的 meta-tool 名（evidence 记录 §4：与 @mos/integrations 描述符数据一致）。
      expect(names).toContain(MULTI_EXECUTE_TOOL);
      expect(names).toContain(SEARCH_TOOLS_TOOL);
      expect(names).toContain(GET_TOOL_SCHEMAS_TOOL);
      const canonical = parseProviderToolName(
        tools.find((tool) => tool.toolName === MULTI_EXECUTE_TOOL)?.canonicalName ?? "",
      );
      expect(canonical?.serverName).toBe("composio-session");
    },
    90_000,
  );

  test(
    "one real external-data read succeeds end-to-end (Hacker News search)",
    async () => {
      const session = await createLiveSession();
      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.2.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      const state = await provider.connectServer("composio-session", {
        kind: "http",
        url: session.mcpUrl,
        headers: { "x-api-key": apiKey },
      });
      expect(state.status).toBe("connected");

      const result = await provider.callTool({
        serverName: "composio-session",
        toolName: MULTI_EXECUTE_TOOL,
        arguments: {
          tools: [
            {
              tool_slug: READ_TOOL_SLUG,
              arguments: { query: "model context protocol", size: 3 },
            },
          ],
          thought: "MOS live verification read",
        },
        timeoutMs: 60_000,
      });
      expect(result.isError).toBe(false);
      const payload = parseExecuteText(result.content) as {
        successful: boolean;
        data: {
          results: Array<{
            response: { successful: boolean; data: { hits: unknown[] } };
          }>;
        };
      };
      expect(payload.successful).toBe(true);
      const first = payload.data.results[0]?.response;
      expect(first?.successful).toBe(true);
      // 形状断言：真实外部数据（公开 Hacker News 帖子）返回非空 hits。
      expect(Array.isArray(first?.data.hits)).toBe(true);
      expect((first?.data.hits.length ?? 0)).toBeGreaterThan(0);
    },
    120_000,
  );

  test(
    "negative matrix: invalid key fails closed on the live session endpoint",
    async () => {
      const session = await createLiveSession();
      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.2.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      // 无效 key（格式同形、非凭据）：initialize 得到 401 → 连接失败 fail-closed。
      const state = await provider.connectServer("composio-bad-key", {
        kind: "http",
        url: session.mcpUrl,
        headers: { "x-api-key": "invalid-key-negative-matrix-probe" },
      });
      expect(state.status).toBe("failed");
      expect(state.error).not.toBeNull();
      const tools = await provider.listTools();
      expect(tools.filter((tool) => tool.serverName === "composio-bad-key")).toEqual([]);
    },
    90_000,
  );
});
