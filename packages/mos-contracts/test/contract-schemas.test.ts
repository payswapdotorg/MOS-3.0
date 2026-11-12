import { describe, expect, test } from "vitest";
import {
  capabilityInstanceSchema,
  capabilitySchema,
  evidenceSchema,
  missionIntakeSchema,
  missionSchema,
  parseOrFail,
  providerConnectionSchema,
  providerImplementationSchema,
  routeSchema,
  tenantContextSchema,
  externalActionPreviewSchema,
  domainEventSchema,
  artifactSchema,
} from "../src/index.js";

const NOW = "2026-11-12T12:00:00.000Z";

function expectInvalid(schema: Parameters<typeof parseOrFail>[1], input: unknown): void {
  const result = schema.safeParse(input);
  expect(result.success, JSON.stringify(input)).toBe(false);
}

describe("TenantContext", () => {
  test("accepts required fields and explicit nulls", () => {
    const value = parseOrFail("TenantContext", tenantContextSchema, {
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      actor_id: "actor-1",
      brand_id: null,
      source_zcode_session_id: null,
      source_zcode_task_id: null,
    });
    expect(value.tenant_id).toBe("tenant-1");
  });

  test("rejects missing actor_id", () => {
    expectInvalid(tenantContextSchema, {
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });
  });
});

describe("Mission", () => {
  test("accepts verbatim objective with explicit null unknowns", () => {
    const value = parseOrFail("Mission", missionSchema, {
      id: "m-1",
      version: 1,
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      objective: "Increase qualified inbound leads.",
      target_audience: null,
      geography: null,
      desired_outcomes: [],
      constraints: {},
      budget: null,
      deadline: null,
      success_metrics: [],
      source_zcode_session_id: "sess_1",
      source_zcode_task_id: "sess_1",
      status: "active",
      created_at: NOW,
      updated_at: NOW,
    });
    expect(value.objective).toBe("Increase qualified inbound leads.");
  });

  test("intake defaults keep unknowns explicit (no inference)", () => {
    const intake = parseOrFail("MissionIntake", missionIntakeSchema, {
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      objective_verbatim: "Grow the newsletter.",
      source_zcode_session_id: null,
      source_zcode_task_id: null,
    });
    expect(intake.target_audience).toBeNull();
    expect(intake.desired_outcomes).toEqual([]);
  });

  test("rejects local-timezone timestamps", () => {
    expectInvalid(missionSchema, {
      id: "m-1",
      version: 1,
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      objective: "x",
      target_audience: null,
      geography: null,
      desired_outcomes: [],
      constraints: {},
      budget: null,
      deadline: null,
      success_metrics: [],
      source_zcode_session_id: null,
      source_zcode_task_id: null,
      status: "active",
      created_at: "2026-11-12T12:00:00+02:00",
      updated_at: NOW,
    });
  });
});

describe("ProviderConnection", () => {
  test("accepts opaque credential_ref and rejects inline token shapes", () => {
    const base = {
      id: "conn-1",
      tenant_id: "tenant-1",
      provider_id: "hubspot",
      provider_account_id: null,
      auth_method: "oauth_authorization_code" as const,
      credential_ref: "mcp:oauth:0123456789abcdef01234567",
      granted_scopes: ["crm.objects.contacts.read"],
      account_type: null,
      app_review_status: null,
      status: "connected" as const,
      last_verified_at: NOW,
    };
    parseOrFail("ProviderConnection", providerConnectionSchema, base);
    expectInvalid(providerConnectionSchema, { ...base, credential_ref: "eyJhbGciOi" });
  });
});

describe("Capability / Implementation / Instance", () => {
  test("capability requires schemas and side-effect class", () => {
    parseOrFail("Capability", capabilitySchema, {
      id: "crm.contacts.read",
      version: 1,
      domain: "crm",
      description: "Read contacts",
      input_schema: {},
      output_schema: {},
      side_effect: "read",
      support_status: "supported",
      required_scopes: ["crm.objects.contacts.read"],
      required_account_types: [],
      risk_level: "low",
    });
    expectInvalid(capabilitySchema, {
      id: "x",
      version: 1,
      domain: "crm",
      input_schema: {},
      output_schema: {},
      side_effect: "read",
      support_status: "maybe",
    });
  });

  test("implementation maps only verified tool names", () => {
    const impl = parseOrFail("ProviderImplementation", providerImplementationSchema, {
      id: "hubspot-crm-contacts-read",
      provider_id: "hubspot",
      capability_id: "crm.contacts.read",
      version: 1,
      operation_mapping: [{ tool_name: "mcp__hubspot__search_contacts", arguments: {} }],
      required_scopes: ["crm.objects.contacts.read"],
      rate_limit_notes: null,
      cost_model: null,
      latency_model: null,
      status: "available",
      evidence_refs: [],
    });
    expect(impl.operation_mapping[0]?.tool_name).toContain("hubspot");
  });

  test("instance keeps unsupported and unknown distinct", () => {
    const base = {
      id: "ci-1",
      tenant_id: "tenant-1",
      connection_id: "conn-1",
      capability_id: "crm.contacts.read",
      implementation_id: "hubspot-crm-contacts-read",
      checked_at: NOW,
      evidence_refs: [],
    };
    parseOrFail("CapabilityInstance", capabilityInstanceSchema, {
      ...base,
      support_status: "unsupported",
      status: "unavailable",
      available_quota: null,
      constraints: [],
      missing_preconditions: ["scope:crm.objects.contacts.read"],
    });
    parseOrFail("CapabilityInstance", capabilityInstanceSchema, {
      ...base,
      support_status: "unknown",
      status: "unknown",
      available_quota: null,
      constraints: [],
      missing_preconditions: [],
    });
  });
});

describe("Route / Preview / Evidence / Artifact / Event", () => {
  test("route distinguishes all five classes fail-closed", () => {
    const base = {
      id: "r-1",
      tenant_id: "tenant-1",
      mission_id: "m-1",
      status: "candidate" as const,
      steps: [{ description: "Read contacts", capability_instance_id: "ci-1", side_effect: "read" as const }],
      preconditions: [],
      approvals: [],
      estimated_cost: null,
      estimated_latency_ms: null,
      confidence: null,
      evidence_refs: [],
      unknowns: [],
      risks: [],
      fallback_route_ids: [],
    };
    for (const route_class of ["existing", "conditional", "opportunity_constrained", "blocked", "unknown"] as const) {
      parseOrFail("Route", routeSchema, { ...base, route_class });
    }
    expectInvalid(routeSchema, { ...base, route_class: "best_effort" });
  });

  test("side-effecting preview requires approval binding and idempotency", () => {
    const base = {
      id: "pv-1",
      tenant_id: "tenant-1",
      connection_id: "conn-1",
      capability_instance_id: "ci-1",
      operation: "update_contact",
      target: { contact_id: "1" },
      artifact_id: null,
      artifact_version: null,
      scheduled_at: null,
      estimated_cost: null,
      side_effect: "update" as const,
      idempotency_key: "pv-1-1",
      preview_hash: "sha256:0",
    };
    parseOrFail("ExternalActionPreview", externalActionPreviewSchema, {
      ...base,
      approval_state: "pending",
    });
    // not_required 在 schema 层合法；不变量层负责拒绝副作用动作使用它（见 domain-invariants.test.ts）。
    parseOrFail("ExternalActionPreview", externalActionPreviewSchema, {
      ...base,
      approval_state: "not_required",
    });
    expectInvalid(externalActionPreviewSchema, {
      ...base,
      approval_state: "maybe",
    });
  });

  test("evidence requires source; artifact keeps lineage", () => {
    parseOrFail("Evidence", evidenceSchema, {
      id: "e-1",
      tenant_id: "tenant-1",
      kind: "provider_response",
      observed_at: NOW,
      source: { observed_via: "hubspot-mcp" },
      subject_ref: null,
      facts: {},
      confidence: null,
      limitations: [],
      raw_payload_ref: null,
    });
    // 空 source 在 schema 层是普通对象；观测来源约束由不变量层执行（见 domain-invariants.test.ts）。
    parseOrFail("Evidence", evidenceSchema, {
      id: "e-1",
      tenant_id: "tenant-1",
      kind: "provider_response",
      observed_at: NOW,
      source: {},
      subject_ref: null,
      facts: {},
      confidence: null,
      limitations: [],
      raw_payload_ref: null,
    });
    expectInvalid(evidenceSchema, {
      id: "e-1",
      tenant_id: "tenant-1",
      kind: "provider_response",
      observed_at: NOW,
      source: { observed_via: "hubspot-mcp" },
      subject_ref: null,
      facts: {},
      confidence: null,
      limitations: [],
      raw_payload_ref: "sk-live-abc123",
    });
    parseOrFail("Artifact", artifactSchema, {
      id: "a-1",
      tenant_id: "tenant-1",
      kind: "draft",
      version: 1,
      content_ref: "artifact-store/a-1/v1",
      parent_artifact_refs: [],
      transform_id: null,
      created_by: { actor_kind: "agent", actor_id: "mos" },
      provenance: [{ source: "user", observed_at: NOW }],
      rights_status: "unknown",
      quality_status: "unreviewed",
      created_at: NOW,
    });
    parseOrFail("DomainEvent", domainEventSchema, {
      id: "ev-1",
      tenant_id: "tenant-1",
      aggregate_type: "mission",
      aggregate_id: "m-1",
      aggregate_version: 1,
      event_type: "mission.created",
      occurred_at: NOW,
      actor: { kind: "human" },
      correlation_id: "corr-1",
      causation_id: null,
      payload: {},
    });
  });
});
