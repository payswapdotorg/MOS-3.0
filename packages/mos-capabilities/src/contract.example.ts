/**
 * contract.example.ts —— 能力目录与实例解析器的使用样例（样例即文档）。
 * HubSpot 联系人读是 W1 的第一条能力：工具映射未核实（verified=false）是
 * 真实状态，解析器因此只会给出 unknown/unavailable，绝不 available。
 */
import {
  HUBSPOT_SEARCH_CONTACTS_TOOL,
  SystemTimePort,
  hubspotProviderDescriptor,
} from "@mos/integrations";
import type { CapabilityDescriptorInput } from "./contract/descriptor.js";
import { CapabilityCatalog } from "./application/catalog.js";
import { CapabilityInstanceResolverService } from "./application/resolver-service.js";
import type { ProviderConnection } from "@mos/contracts";

/** HubSpot 联系人读的描述符（数据与 provider 描述符/evidence 记录一致）。 */
export function exampleHubSpotContactsDescriptor(): CapabilityDescriptorInput {
  const candidate = hubspotProviderDescriptor.candidateTools[0];
  return {
    id: "desc-hubspot-contacts-read",
    version: 1,
    domain: "crm",
    description: "Search HubSpot CRM contacts (read-only).",
    capabilityId: "crm.contacts.read",
    providerId: hubspotProviderDescriptor.providerId,
    // 描述符相邻的 connector 模板包（hubspot-connector-template 的 manifest name）。
    integrationId: "mos-hubspot-connector",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    outputSchema: { type: "object" },
    sideEffect: "read",
    riskLevel: "low",
    requiredScopes: ["crm.objects.contacts.read"],
    requiredAccountTypes: [],
    requiredAppReview: null,
    permissionMode: "zcode_existing_permissions",
    evidenceSource: {
      documentationUrl: hubspotProviderDescriptor.officialDocs,
      observedAt: "2026-11-12T00:00:00Z",
    },
    knownGaps: ["tool mapping unverified: no provider account in this environment"],
    supportStatus: "supported",
    fallback: null,
    toolMapping: {
      toolName: candidate?.toolName ?? HUBSPOT_SEARCH_CONTACTS_TOOL,
      verified: false,
      verifiedAt: null,
    },
  };
}

/** 一个已连接的 tenant 连接（credential_ref 是指向 ZCode 凭据存储的不透明引用）。 */
export function exampleConnectedConnection(): ProviderConnection {
  return {
    id: "conn-demo",
    tenant_id: "tenant-acme",
    provider_id: "hubspot",
    provider_account_id: "portal-1025010",
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: "2026-11-12T00:00:00Z",
  };
}

/** 目录注册 + 实例解析：工具映射未核实 → unknown/unavailable（fail-closed 现状）。 */
export function exampleResolveHubSpotContacts() {
  const catalog = new CapabilityCatalog();
  catalog.register(exampleHubSpotContactsDescriptor());
  const implementation = catalog.registerImplementation({
    id: "impl-hubspot-contacts-read",
    provider_id: "hubspot",
    capability_id: "crm.contacts.read",
    version: 1,
    operation_mapping: [{ tool_name: HUBSPOT_SEARCH_CONTACTS_TOOL, arguments: {} }],
    status: "available",
    evidence_refs: ["spec/integrations/provider-evidence/hubspot-connector-evidence.md"],
  });

  const resolver = new CapabilityInstanceResolverService({
    catalog,
    time: new SystemTimePort(),
  });
  const instance = resolver.resolveForConnection({
    tenantId: "tenant-acme",
    connection: exampleConnectedConnection(),
    capabilityId: "crm.contacts.read",
    implementationId: implementation.id,
  });
  // W1 现状断言：support_status=unknown、status=unavailable、
  // missing_preconditions=["tool_mapping_unverified"] —— live 验证后才会变 available。
  return instance;
}

/**
 * Composio（W2）：第一条 toolMappingVerified=true 的能力描述符 ——
 * 与 HubSpot 样例的差异只在数据：工具映射经 live session MCP 核实
 * （tools/list 枚举 + 一次真实外部数据读，见 composio-connector-evidence.md §4/§6），
 * 因此与真实 connected 连接（auth_method=api_key、无 scope 要求）解析出 available。
 */
export function exampleComposioDiscussionSearchDescriptor(): CapabilityDescriptorInput {
  return {
    id: "desc-composio-discussion-search",
    version: 1,
    domain: "research",
    description: "Search public discussion posts (Hacker News) through the Composio hosted session MCP (read-only).",
    capabilityId: "research.discussion.search",
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

/** Composio 真实连接的样例（credential_ref 指向 ZCode 凭据存储的不透明引用）。 */
export function exampleComposioConnection(): ProviderConnection {
  return {
    id: "conn-composio-demo",
    tenant_id: "tenant-acme",
    provider_id: "composio",
    provider_account_id: null,
    auth_method: "api_key",
    credential_ref: "mcp:apikey:0a1b2c3d4e5f60718293a4b5",
    granted_scopes: [],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: "2026-11-13T00:00:00Z",
  };
}

/** 目录注册 + 实例解析：核实映射 + 真实连接 + 证据齐备 → available（live 证据支撑）。 */
export function exampleResolveComposioDiscussionSearch() {
  const catalog = new CapabilityCatalog();
  catalog.register(exampleComposioDiscussionSearchDescriptor());
  const implementation = catalog.registerImplementation({
    id: "impl-composio-discussion-search",
    provider_id: "composio",
    capability_id: "research.discussion.search",
    version: 1,
    operation_mapping: [
      {
        tool_name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: { tools: [{ tool_slug: "HACKERNEWS_SEARCH_POSTS", arguments: {} }] },
      },
    ],
    status: "available",
    evidence_refs: ["spec/integrations/provider-evidence/composio-connector-evidence.md"],
  });

  const resolver = new CapabilityInstanceResolverService({
    catalog,
    time: new SystemTimePort(),
  });
  return resolver.resolveForConnection({
    tenantId: "tenant-acme",
    connection: exampleComposioConnection(),
    capabilityId: "research.discussion.search",
    implementationId: implementation.id,
  });
}
