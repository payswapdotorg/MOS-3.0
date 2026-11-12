/**
 * contract.example.ts —— 契约的使用样例（architecture 模块要求的产物之一）。
 * 样例即文档：展示最小合法对象与不变量守卫的调用方式。
 */
import {
  assertCapabilityInstanceAvailability,
  assertConnectionHoldsNoSecrets,
  assertEvidenceProvenance,
  assertNoInferredMissionFields,
  evidenceSchema,
  missionSchema,
  parseOrFail,
  providerConnectionSchema,
  capabilityInstanceSchema,
  type CapabilityInstance,
  type Evidence,
  type Mission,
  type ProviderConnection,
} from "./index.js";

/** 最小 TenantContext 归属的 Mission：objective 逐字保存，其余字段显式 null（零推断）。 */
export function exampleMission(now: string): Mission {
  return parseOrFail("Mission", missionSchema, {
    id: "mission-01",
    version: 1,
    tenant_id: "tenant-acme",
    workspace_id: "ws-acme-main",
    objective: "Find a way to increase qualified inbound leads over the next 90 days.",
    target_audience: null,
    geography: null,
    desired_outcomes: [],
    constraints: {},
    budget: null,
    deadline: null,
    success_metrics: [],
    source_zcode_session_id: "sess_demo",
    source_zcode_task_id: "sess_demo",
    status: "active",
    created_at: now,
    updated_at: now,
  });
}

/** 连接记录：只有不透明 credential_ref，没有任何令牌值。 */
export function exampleConnection(now: string): ProviderConnection {
  const connection = parseOrFail("ProviderConnection", providerConnectionSchema, {
    id: "conn-hubspot-01",
    tenant_id: "tenant-acme",
    provider_id: "hubspot",
    provider_account_id: "portal-1024",
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0f1e2d3c4b5a697880909192",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: now,
  });
  assertConnectionHoldsNoSecrets(connection);
  return connection;
}

/** 能力实例必须由实时检查支撑才允许 available。 */
export function exampleCapabilityInstance(now: string): CapabilityInstance {
  const instance = parseOrFail("CapabilityInstance", capabilityInstanceSchema, {
    id: "capinst-hubspot-contacts-read-01",
    tenant_id: "tenant-acme",
    connection_id: "conn-hubspot-01",
    capability_id: "crm.contacts.read",
    implementation_id: "hubspot-crm-contacts-read",
    support_status: "supported",
    status: "available",
    available_quota: null,
    constraints: [],
    missing_preconditions: [],
    checked_at: now,
    evidence_refs: ["evidence-01"],
  });
  assertCapabilityInstanceAvailability(instance, {
    liveConnectionChecked: true,
    requiredScopesCovered: true,
  });
  return instance;
}

/** 证据：source + observed_at 齐备，simulation 不得冒充 provider 观测。 */
export function exampleEvidence(now: string): Evidence {
  const evidence = parseOrFail("Evidence", evidenceSchema, {
    id: "evidence-01",
    tenant_id: "tenant-acme",
    kind: "provider_response",
    observed_at: now,
    source: { observed_via: "hubspot-mcp", tool: "read_contacts", observed_at: now },
    subject_ref: "conn-hubspot-01",
    facts: { record_count: 0 },
    confidence: 1,
    limitations: ["contract-level only"],
    raw_payload_ref: null,
  });
  assertEvidenceProvenance(evidence);
  return evidence;
}

export { assertNoInferredMissionFields };
