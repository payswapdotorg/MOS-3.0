import { z } from "zod";
import { authMethodSchema, contractVersionSchema } from "@mos/contracts";

/**
 * Provider 描述符 —— provider-integration-strategy-v3.0.md §2 第 1/2 层的机读投影。
 * 描述符只声明"可能存在的映射"，绝不构成账户授权证据（strategy §3；
 * 账户能力判定由 mos-capabilities 的实例解析器承担）。
 *
 * fail-closed 约定：`toolMappingVerified` 必须显式声明。本环境中 HubSpot MCP 的
 * 工具名未经真实服务枚举核实（无 provider 账号/OAuth client），因此恒为 false；
 * 候选工具名只用于 contract-level 适配器（read-adapter），不得据此宣称 live 能力。
 */

/** 远程 MCP endpoint 种类（W1 只声明 http remote MCP；stdio/sse 归 ZCode 插件层）。 */
export const providerEndpointSchema = z.object({
  kind: z.literal("http"),
  url: z.string().min(1),
});
export type ProviderEndpoint = z.infer<typeof providerEndpointSchema>;

/** 候选工具：verified=false 表示工具名未经 live server 枚举核实。 */
export const providerCandidateToolSchema = z.object({
  toolName: z.string().min(1),
  purpose: z.string().min(1),
  verified: z.boolean(),
  note: z.string().nullable(),
});
export type ProviderCandidateTool = z.infer<typeof providerCandidateToolSchema>;

/**
 * 版本化 provider 描述符 schema。status 使用 AGENTS.md §7 的完成词汇
 * （"planned-live-read" = live 读已规划、尚未以真实账号证明）。
 */
export const providerDescriptorSchema = z.object({
  version: contractVersionSchema,
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  endpoint: providerEndpointSchema,
  authMethod: authMethodSchema,
  officialDocs: z.string().min(1),
  status: z.string().min(1),
  toolMappingVerified: z.boolean(),
  candidateTools: z.array(providerCandidateToolSchema),
  evidenceRefs: z.array(z.string().min(1)),
});
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

/** HubSpot 联系人读的候选工具名（UNVERIFIED：未经 live HubSpot MCP server 枚举核实）。 */
export const HUBSPOT_SEARCH_CONTACTS_TOOL = "hubspot_search_contacts";

/**
 * HubSpot 官方远程 MCP 的 provider 描述符（纯数据对象，运行时校验经
 * providerDescriptorSchema 完成，见 test/hubspot-descriptor.test.ts）。
 * 凭据/令牌永不落库：ZCode 凭据存储的 key 形如 `mcp:oauth:<24hex>`，
 * 连接记录只允许持有这类不透明 credential_ref。
 */
export const hubspotProviderDescriptor: ProviderDescriptor = {
  version: 1,
  providerId: "hubspot",
  displayName: "HubSpot",
  endpoint: {
    kind: "http",
    url: "https://mcp.hubspot.com/",
  },
  authMethod: "oauth_authorization_code",
  officialDocs: "https://developers.hubspot.com/mcp",
  status: "planned-live-read",
  toolMappingVerified: false,
  candidateTools: [
    {
      toolName: HUBSPOT_SEARCH_CONTACTS_TOOL,
      purpose: "Search HubSpot CRM contacts (read-only).",
      verified: false,
      note: "Candidate tool name; NOT verified against the live HubSpot MCP server in this environment (no provider account or OAuth client).",
    },
  ],
  evidenceRefs: ["spec/integrations/provider-evidence/hubspot-connector-evidence.md"],
};
