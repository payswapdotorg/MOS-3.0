import { createMcpAdapter, createSharedZCodeCredentialStore } from "@zcode/adapters";
import type { McpPort } from "@zcode/contracts";
import {
  SystemTimePort,
  toProviderToolName,
  type ProviderPort,
  type ProviderServerConfig,
  type ProviderServerState,
} from "@mos/adapters";
import type { StudioPorts } from "../application/studio-service.js";

/**
 * 真实栈接线（组合根独有；依赖 `pnpm --filter @zcode/adapters... build` 的 dist 导出，
 * 因此本目录排除在默认 typecheck 之外 —— 与 @mos/adapters test/integration 同约定，
 * 见 PR #3 的 fresh-clone 教训）。构建由 scripts/build.mjs 经 esbuild 完成（不 typecheck）。
 *
 * - 真实 ZCode MCP 客户端（createMcpAdapter；stdio/http/sse）；
 * - 真实共享加密凭据存储（createSharedZCodeCredentialStore；与宿主同库、文件锁跨进程安全）；
 * - ProviderPort → McpPort 的生产适配（与 zcode-mos-adapters 集成测试中
 *   "生产组合根将来做的就是这一层适配" 的文档形状一致）。
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
        structuredContent:
          result.structuredContent === undefined || result.structuredContent === null
            ? null
            : (result.structuredContent as Record<string, unknown>),
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

/** 每次授权读一个全新 MCP 客户端实例（会话隔离；读完即关）。 */
export function createRealStudioPorts(): StudioPorts {
  const credentialStore = createSharedZCodeCredentialStore();
  return {
    createProviderPort: () =>
      providerPortOverMcp(
        createMcpAdapter({ clientName: "mos-studio", clientVersion: "0.1.0" }),
      ),
    credentialStore: {
      save: (key, value) => credentialStore.save(key, value),
      load: (key) => credentialStore.load(key),
    },
    time: new SystemTimePort(),
    fetch: globalThis.fetch,
  };
}
