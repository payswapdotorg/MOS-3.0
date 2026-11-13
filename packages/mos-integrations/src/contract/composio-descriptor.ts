import { z } from "zod";
import {
  providerDescriptorSchema,
  type ProviderDescriptor,
} from "./hubspot-descriptor.js";

/**
 * Composio provider 描述符 —— 与 hubspot-descriptor 同一 schema（providerDescriptorSchema），
 * 差异只在数据：Composio 的 hosted session MCP 是**已核实**的（toolMappingVerified=true），
 * 依据 spec/integrations/provider-evidence/composio-connector-evidence.md 的 live 观测：
 * 2026-11-13 真实 session MCP endpoint 上 tools/list 枚举出全部 meta-tool，
 * 并经 COMPOSIO_MULTI_EXECUTE_TOOL 完成一次真实外部数据读（Hacker News 搜索）。
 *
 * endpoint 语义：session-based —— 具体 MCP URL 由 REST session API 逐会话签发
 * （`POST /api/v3.1/tool_router/session` 返回 `mcp.url`），描述符只声明
 * session 工厂与 URL 模式；授权材料 = 文档化的 `x-api-key` header，
 * 由组合根运行时从凭据存储注入（auth_method=api_key）。
 */

/** session 工厂（REST）与 hosted MCP URL 模式；<session_id> 为逐会话不透明段。 */
export const COMPOSIO_SESSION_FACTORY_URL =
  "https://backend.composio.dev/api/v3.1/tool_router/session";
export const COMPOSIO_MCP_URL_PATTERN = "https://backend.composio.dev/tool_router/<session_id>/mcp";

/** 已核实的 meta-tool 名（live tools/list 观测，见 evidence 记录 §4）。 */
export const COMPOSIO_SEARCH_TOOLS_TOOL = "COMPOSIO_SEARCH_TOOLS";
export const COMPOSIO_GET_TOOL_SCHEMAS_TOOL = "COMPOSIO_GET_TOOL_SCHEMAS";
export const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";

/** 已核实的目标工具（session 限定 toolkit=hackernews 下的真实读）。 */
export const HACKERNEWS_SEARCH_POSTS_TOOL = "HACKERNEWS_SEARCH_POSTS";

/**
 * session 工厂请求体 schema（toolkits 限定 no-auth toolkit，最小真实读面）。
 * mcp:true 必须显式；本包只声明形状，调用属组合根/集成测试的 provider I/O。
 */
export const composioSessionRequestSchema = z.object({
  user_id: z.string().min(1),
  mcp: z.literal(true),
  toolkits: z.object({ enable: z.array(z.string().min(1)).min(1) }),
});
export type ComposioSessionRequest = z.infer<typeof composioSessionRequestSchema>;

/** session 工厂响应里 MOS 消费的最小子集（mcp.url；headers 键名做形状校验）。 */
export const composioSessionResponseSchema = z.object({
  session_id: z.string().min(1),
  mcp: z.object({ type: z.string().min(1), url: z.string().min(1) }),
});
export type ComposioSessionResponse = z.infer<typeof composioSessionResponseSchema>;

/**
 * Composio 官方 hosted session MCP 的 provider 描述符（纯数据对象，运行时校验见
 * test/composio-descriptor.test.ts）。status=verified：真实账号 + 真实读已按
 * AGENTS.md §7 的 live evidence 标准完成（evidence 记录 §6/§7）。
 */
export const composioProviderDescriptor: ProviderDescriptor = {
  version: 1,
  providerId: "composio",
  displayName: "Composio",
  endpoint: {
    kind: "http",
    url: COMPOSIO_MCP_URL_PATTERN,
  },
  authMethod: "api_key",
  officialDocs: "https://docs.composio.dev/docs/sessions-via-mcp",
  status: "verified",
  toolMappingVerified: true,
  candidateTools: [
    {
      toolName: COMPOSIO_SEARCH_TOOLS_TOOL,
      purpose: "Search available provider tools on the hosted session MCP.",
      verified: true,
      note: "Observed on the live session MCP endpoint via tools/list (evidence record section 4).",
    },
    {
      toolName: COMPOSIO_MULTI_EXECUTE_TOOL,
      purpose: "Execute provider tools (read paths) through the hosted session MCP.",
      verified: true,
      note: "Observed on the live session MCP endpoint; carried one real external-data read (evidence record section 6).",
    },
    {
      toolName: HACKERNEWS_SEARCH_POSTS_TOOL,
      purpose: "Search Hacker News posts (read-only, no-auth toolkit), executed via the multi-execute meta-tool.",
      verified: true,
      note: "Executed once on the live session MCP (toolkits scoped to hackernews); real external data returned (evidence record section 6).",
    },
  ],
  evidenceRefs: ["spec/integrations/provider-evidence/composio-connector-evidence.md"],
};
