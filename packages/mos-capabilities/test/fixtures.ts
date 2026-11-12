import type { CapabilityDescriptorInput } from "../src/index.js";
import type { ProviderConnection, ProviderImplementation } from "@mos/contracts";

/** 测试夹具：W1 第一条能力（HubSpot 联系人读）的最小合法事实集。 */

export const HUBSPOT_EVIDENCE_REF = "spec/integrations/provider-evidence/hubspot-connector-evidence.md";
export const CAPABILITY_ID = "crm.contacts.read";
export const IMPLEMENTATION_ID = "impl-hubspot-contacts-read";
export const NOW = "2026-11-12T00:00:00Z";

export function baseDescriptor(
  overrides: Partial<CapabilityDescriptorInput> = {},
): CapabilityDescriptorInput {
  return {
    id: "desc-hubspot-contacts-read",
    version: 1,
    domain: "crm",
    description: "Search HubSpot CRM contacts.",
    capabilityId: CAPABILITY_ID,
    providerId: "hubspot",
    integrationId: "mos-hubspot-connector",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    sideEffect: "read",
    riskLevel: "low",
    requiredScopes: ["crm.objects.contacts.read"],
    requiredAccountTypes: [],
    requiredAppReview: null,
    permissionMode: "zcode_existing_permissions",
    evidenceSource: {
      documentationUrl: "https://developers.hubspot.com/mcp",
      observedAt: NOW,
    },
    knownGaps: ["tool mapping unverified: no provider account in this environment"],
    supportStatus: "supported",
    fallback: null,
    toolMapping: { toolName: "hubspot_search_contacts", verified: false, verifiedAt: null },
    ...overrides,
  };
}

export function baseConnection(
  overrides: Partial<ProviderConnection> = {},
): ProviderConnection {
  return {
    id: "conn-1",
    tenant_id: "tenant-acme",
    provider_id: "hubspot",
    provider_account_id: "portal-1025010",
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: NOW,
    ...overrides,
  };
}

export function baseImplementation(
  overrides: Partial<ProviderImplementation> = {},
): ProviderImplementation {
  return {
    id: IMPLEMENTATION_ID,
    provider_id: "hubspot",
    capability_id: CAPABILITY_ID,
    version: 1,
    operation_mapping: [{ tool_name: "hubspot_search_contacts", arguments: {} }],
    required_scopes: [],
    rate_limit_notes: null,
    cost_model: null,
    latency_model: null,
    status: "available",
    evidence_refs: [HUBSPOT_EVIDENCE_REF],
    ...overrides,
  };
}
