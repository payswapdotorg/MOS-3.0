import { describe, expect, test } from "vitest";
import {
  InvariantViolation,
  assertArtifactLineageImmutability,
  assertCapabilityInstanceAvailability,
  assertConnectionHoldsNoSecrets,
  assertDistinctSupportStates,
  assertEvidenceProvenance,
  assertExternalActionPreview,
  assertNoInferredMissionFields,
  capabilityInstanceSchema,
  evidenceSchema,
  externalActionPreviewSchema,
  missionSchema,
  parseOrFail,
  providerConnectionSchema,
  type CapabilityInstance,
  type Evidence,
  type ExternalActionPreview,
  type Mission,
  type ProviderConnection,
} from "../src/index.js";

const NOW = "2026-11-12T12:00:00.000Z";

function missionFixture(overrides: Record<string, unknown> = {}): Mission {
  return parseOrFail("Mission", missionSchema, {
    id: "m-1",
    version: 1,
    tenant_id: "tenant-1",
    workspace_id: "ws-1",
    objective: "verbatim objective",
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
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function connectionFixture(overrides: Record<string, unknown> = {}): ProviderConnection {
  return parseOrFail("ProviderConnection", providerConnectionSchema, {
    id: "conn-1",
    tenant_id: "tenant-1",
    provider_id: "hubspot",
    provider_account_id: null,
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0123456789abcdef01234567",
    granted_scopes: [],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: NOW,
    ...overrides,
  });
}

function instanceFixture(overrides: Record<string, unknown> = {}): CapabilityInstance {
  return parseOrFail("CapabilityInstance", capabilityInstanceSchema, {
    id: "ci-1",
    tenant_id: "tenant-1",
    connection_id: "conn-1",
    capability_id: "crm.contacts.read",
    implementation_id: "hubspot-crm-contacts-read",
    support_status: "supported",
    status: "available",
    available_quota: null,
    constraints: [],
    missing_preconditions: [],
    checked_at: NOW,
    evidence_refs: [],
    ...overrides,
  });
}

function previewFixture(overrides: Record<string, unknown> = {}): ExternalActionPreview {
  return parseOrFail("ExternalActionPreview", externalActionPreviewSchema, {
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
    side_effect: "update",
    approval_state: "pending",
    idempotency_key: "pv-1-1",
    preview_hash: "sha256:0",
    ...overrides,
  });
}

function evidenceFixture(overrides: Record<string, unknown> = {}): Evidence {
  return parseOrFail("Evidence", evidenceSchema, {
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
    ...overrides,
  });
}

describe("capability instance invariants", () => {
  test("available without live check evidence is rejected", () => {
    const instance = instanceFixture();
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: false,
        requiredScopesCovered: true,
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: false,
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: true,
      }),
    ).not.toThrow();
  });

  test("unavailable instance never needs live-check basis", () => {
    const instance = instanceFixture({ status: "unavailable", support_status: "unsupported" });
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: false,
        requiredScopesCovered: false,
      }),
    ).not.toThrow();
  });

  test("unsupported and unknown remain distinct", () => {
    assertDistinctSupportStates("supported");
    assertDistinctSupportStates("unsupported");
    assertDistinctSupportStates("unknown");
    expect(() => assertDistinctSupportStates("maybe" as never)).toThrow(InvariantViolation);
  });
});

describe("external action invariants", () => {
  test("side-effecting action must be approval-bound and idempotent", () => {
    expect(() => assertExternalActionPreview(previewFixture())).not.toThrow();
    expect(() =>
      assertExternalActionPreview(previewFixture({ approval_state: "not_required" })),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertExternalActionPreview(previewFixture({ idempotency_key: null })),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertExternalActionPreview(previewFixture({ side_effect: "read", approval_state: "not_required" })),
    ).not.toThrow();
  });
});

describe("evidence provenance invariants", () => {
  test("provider observation requires observed_via source", () => {
    expect(() => assertEvidenceProvenance(evidenceFixture())).not.toThrow();
    expect(() => assertEvidenceProvenance(evidenceFixture({ source: {} }))).toThrow(InvariantViolation);
  });

  test("simulation is stored as simulation, never as provider observation", () => {
    const simulated = evidenceFixture({
      kind: "simulation",
      source: { observed_via: "local-standin" },
    });
    expect(() => assertEvidenceProvenance(simulated)).not.toThrow();
    expect(simulated.kind).not.toBe("provider_response");
  });
});

describe("artifact / connection / mission invariants", () => {
  test("artifact lineage is immutable", () => {
    const previous = { version: 2, parent_artifact_refs: ["a-root"] };
    expect(() =>
      assertArtifactLineageImmutability(previous, {
        version: 3,
        parent_artifact_refs: ["a-root"],
      }),
    ).not.toThrow();
    expect(() =>
      assertArtifactLineageImmutability(previous, {
        version: 2,
        parent_artifact_refs: ["a-root"],
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertArtifactLineageImmutability(previous, {
        version: 3,
        parent_artifact_refs: ["a-rewritten"],
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertArtifactLineageImmutability(null, {
        version: 1,
        parent_artifact_refs: [],
      }),
    ).not.toThrow();
  });

  test("connection holds no secret material", () => {
    const clean = connectionFixture();
    expect(() => assertConnectionHoldsNoSecrets(clean)).not.toThrow();

    // schema 层会拒绝内联令牌形状；这里直接构造带敏感字段名的记录验证不变量守卫本身。
    const withSecretField = { ...clean, api_key: "opaque-ref-or-value" } as unknown as ProviderConnection;
    expect(() => assertConnectionHoldsNoSecrets(withSecretField)).toThrow(InvariantViolation);

    const withInlineToken = {
      ...clean,
      provider_account_id: "eyJhbGciOiJIUzI1NiJ9.e30.sig",
    } as ProviderConnection;
    expect(() => assertConnectionHoldsNoSecrets(withInlineToken)).toThrow(InvariantViolation);
  });

  test("mission never infers missing values", () => {
    expect(() => assertNoInferredMissionFields(missionFixture())).not.toThrow();
    const withBlank = missionFixture({ target_audience: "" });
    expect(() => assertNoInferredMissionFields(withBlank)).toThrow(InvariantViolation);
    const withWhitespace = missionFixture({ objective: "   " });
    expect(() => assertNoInferredMissionFields(withWhitespace)).toThrow(InvariantViolation);
  });
});
