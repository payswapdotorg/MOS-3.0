import type { CapabilityDescriptorInput } from "@mos/capabilities";
import {
  STUDIO_COMPOSIO_CAPABILITY_ID,
  STUDIO_COMPOSIO_DESCRIPTOR_ID,
  STUDIO_COMPOSIO_IMPLEMENTATION_ID,
} from "../contract/studio-vocabulary.js";

/**
 * 组合根声明的能力目录数据 —— 数值全部来自已核实证据（不发明）：
 * spec/integrations/provider-evidence/composio-connector-evidence.md（W2 live 观测：
 * 2026-11-13 真实 session MCP tools/list 枚举 + 一次真实外部数据读）。
 * 与 @mos/capabilities contract.example 同源同值；example 是文档样例，这里是组合根的实数据。
 */

export function studioComposioDiscussionSearchDescriptor(): CapabilityDescriptorInput {
  return {
    id: STUDIO_COMPOSIO_DESCRIPTOR_ID,
    version: 1,
    domain: "research",
    description:
      "Search public discussion posts (Hacker News) through the Composio hosted session MCP (read-only).",
    capabilityId: STUDIO_COMPOSIO_CAPABILITY_ID,
    providerId: "composio",
    integrationId: "mos-composio-session-mcp",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, size: { type: "integer" } },
      required: ["query"],
    },
    outputSchema: { type: "object" },
    sideEffect: "read",
    riskLevel: "low",
    requiredScopes: [],
    requiredAccountTypes: [],
    requiredAppReview: null,
    permissionMode: "zcode_existing_permissions",
    evidenceSource: {
      documentationUrl: "https://docs.composio.dev/docs/sessions-via-mcp",
      observedAt: "2026-11-13T00:00:00Z",
    },
    knownGaps: [],
    supportStatus: "supported",
    fallback: null,
    toolMapping: {
      toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
      verified: true,
      verifiedAt: "2026-11-13T00:00:00Z",
    },
  };
}

export interface StudioImplementationInput {
  readonly id: string;
  readonly provider_id: string;
  readonly capability_id: string;
  readonly version: number;
  readonly operation_mapping: {
    tool_name: string;
    arguments: Record<string, unknown>;
  }[];
  readonly status: "unknown" | "available" | "degraded" | "unavailable";
  readonly evidence_refs: string[];
}

export function studioComposioDiscussionSearchImplementation(): StudioImplementationInput {
  return {
    id: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
    provider_id: "composio",
    capability_id: STUDIO_COMPOSIO_CAPABILITY_ID,
    version: 1,
    operation_mapping: [
      {
        tool_name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: { tools: [{ tool_slug: "HACKERNEWS_SEARCH_POSTS", arguments: {} }] },
      },
    ],
    status: "available",
    evidence_refs: ["spec/integrations/provider-evidence/composio-connector-evidence.md"],
  };
}
