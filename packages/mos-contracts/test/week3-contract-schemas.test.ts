import { describe, expect, test } from "vitest";
import {
  assertDistributionPreviewApproval,
  assertExperimentOutcomeEvidence,
  assertGraphEngineRefsOpaque,
  assertJobNeverExecutes,
  assertRightsClearedForUse,
  calibrationRecordSchema,
  distributionIntentSchema,
  engineSchema,
  experimentSchema,
  InvariantViolation,
  parseOrFail,
  productionGraphSchema,
  productionJobSchema,
  rightsRecordSchema,
  transformSchema,
} from "../src/index.js";

const NOW = "2026-11-13T12:00:00.000Z";
const LATER = "2026-11-13T18:00:00.000Z";

function transformInput(overrides: Record<string, unknown> = {}) {
  return transformSchema.parse({
    id: "tr-caption",
    tenant_id: "tenant-1",
    version: 1,
    name: "caption",
    description: null,
    parameters_schema: { type: "object" },
    required_capability_id: "media.caption",
    side_effect: "none",
    risk_level: "low",
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function engineInput(overrides: Record<string, unknown> = {}) {
  return engineSchema.parse({
    id: "engine-local-ffmpeg",
    tenant_id: "tenant-1",
    version: 1,
    display_name: "Local media engine",
    capability_ids: ["media.caption", "media.clip"],
    provider_id: null,
    sandbox_policy: { network_egress: false, filesystem_scope: "workspace" },
    benchmark_refs: [],
    license_terms: null,
    cost_model: null,
    status: "registered",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function graphInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "graph-1",
    tenant_id: "tenant-1",
    mission_id: null,
    version: 1,
    name: "caption then review",
    nodes: [
      { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
      { id: "n2", kind: "engine", ref: "engine-local-ffmpeg", parameters: {} },
      { id: "n3", kind: "review_gate", ref: null, parameters: {} },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
    status: "draft",
    validated_at: null,
    validation_errors: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function jobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    tenant_id: "tenant-1",
    graph_id: "graph-1",
    graph_version: 1,
    status: "pending",
    zcode_execution_ref: null,
    started_at: null,
    completed_at: null,
    output_artifact_refs: [],
    failure: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function rightsInput(overrides: Record<string, unknown> = {}) {
  return rightsRecordSchema.parse({
    id: "rights-1",
    tenant_id: "tenant-1",
    kind: "source_license",
    subject_ref: "asset-brief",
    subject_artifact_ref: "art-1",
    constraints: [],
    evidence_refs: [],
    decision: "granted",
    decided_at: NOW,
    expires_at: LATER,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function intentInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "dist-1",
    tenant_id: "tenant-1",
    operation: "publish",
    connection_id: "conn-1",
    capability_instance_id: "ci-1",
    artifact_ref: "art-1",
    artifact_version: 2,
    target: { channel: "youtube" },
    preview_ref: null,
    preview_hash: null,
    approval_state: "not_required",
    idempotency_key: null,
    status: "intent",
    execution_records: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function experimentInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    tenant_id: "tenant-1",
    mission_id: "m-1",
    hypothesis_id: "hyp-1",
    statement: "Pricing page increases qualified leads.",
    design: { variant: "with-pricing", measure: "qualified_leads" },
    assignment: null,
    measurement_evidence_refs: [],
    status: "defined",
    outcome: null,
    outcome_note: null,
    started_at: null,
    concluded_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("W3 schemas", () => {
  test("Transform accepts active definition with capability linkage", () => {
    const value = transformInput();
    expect(value.status).toBe("active");
    expect(value.required_capability_id).toBe("media.caption");
  });

  test("Transform rejects empty names and bad status", () => {
    expect(() => transformInput({ name: "" })).toThrow();
    expect(() => transformInput({ status: "live" })).toThrow();
  });

  test("Engine accepts registry record with sandbox policy object", () => {
    const value = engineInput();
    expect(value.capability_ids).toContain("media.caption");
    expect(value.sandbox_policy.network_egress).toBe(false);
  });

  test("Engine rejects empty display_name and unknown status", () => {
    expect(() => engineInput({ display_name: "" })).toThrow();
    expect(() => engineInput({ status: "available" })).toThrow();
  });

  test("ProductionGraph accepts node kinds with opaque refs (null allowed in draft)", () => {
    const value = parseOrFail("ProductionGraph", productionGraphSchema, graphInput());
    expect(value.nodes[2]?.ref).toBeNull();
  });

  test("ProductionGraph rejects unknown node kinds and bad edges", () => {
    expect(() =>
      productionGraphSchema.parse(graphInput({ nodes: [{ id: "n9", kind: "llm", ref: null, parameters: {} }] })),
    ).toThrow();
  });

  test("ProductionJob accepts pending without external execution ref", () => {
    const value = parseOrFail("ProductionJob", productionJobSchema, jobInput());
    expect(value.zcode_execution_ref).toBeNull();
  });

  test("RightsRecord accepts granted with expiry; rejects outcome-like decision", () => {
    expect(rightsRecordSchema.parse(rightsInput()).decision).toBe("granted");
    expect(() => rightsRecordSchema.parse(rightsInput({ decision: "cleared" }))).toThrow();
  });

  test("DistributionIntent accepts intent state; rejects unknown operation", () => {
    expect(distributionIntentSchema.parse(intentInput()).status).toBe("intent");
    expect(() => distributionIntentSchema.parse(intentInput({ operation: "archive" }))).toThrow();
  });

  test("Experiment accepts definition without outcome; rejects fake outcome status", () => {
    const value = experimentInput();
    expect(value.outcome).toBeNull();
    expect(() => experimentSchema.parse(experimentInput({ status: "running" }))).toThrow();
  });

  test("CalibrationRecord is delayed-mode only (literal true)", () => {
    const value = calibrationRecordSchema.parse({
      id: "cal-1",
      tenant_id: "tenant-1",
      experiment_ref: "exp-1",
      calibration: { lift: 0.12 },
      recommendation: "keep pricing page",
      delayed_mode: true,
      evidence_refs: ["ev-1"],
      created_at: NOW,
      updated_at: NOW,
    });
    expect(value.delayed_mode).toBe(true);
    expect(() =>
      calibrationRecordSchema.parse({
        id: "cal-2",
        tenant_id: "tenant-1",
        experiment_ref: "exp-1",
        calibration: {},
        delayed_mode: false,
        evidence_refs: [],
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toThrow();
  });
});

describe("W3 invariants", () => {
  test("rights gate: granted+unexpired record clears use", () => {
    expect(() =>
      assertRightsClearedForUse({
        artifactRef: "art-1",
        records: [rightsInput()],
        now: NOW,
      }),
    ).not.toThrow();
  });

  test("rights gate: missing / denied / pending / expired records all deny", () => {
    expect(() =>
      assertRightsClearedForUse({ artifactRef: "art-1", records: [], now: NOW }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertRightsClearedForUse({
        artifactRef: "art-1",
        records: [rightsInput({ decision: "denied" })],
        now: NOW,
      }),
    ).toThrow(/denied/);
    expect(() =>
      assertRightsClearedForUse({
        artifactRef: "art-1",
        records: [rightsInput({ decision: "pending" })],
        now: NOW,
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertRightsClearedForUse({
        artifactRef: "art-1",
        records: [rightsInput({ expires_at: "2026-11-13T12:00:01.000Z" })],
        now: LATER,
      }),
    ).toThrow(/未过期/);
  });

  test("job never executes: beyond-linked requires external ZCode ref + started_at", () => {
    expect(() => assertJobNeverExecutes(parseOrFail("ProductionJob", productionJobSchema, jobInput()))).not.toThrow();
    const linked = jobInput({ status: "linked", zcode_execution_ref: "zcode:wf:abc" });
    expect(() => assertJobNeverExecutes(parseOrFail("ProductionJob", productionJobSchema, linked))).not.toThrow();
    const executing = jobInput({ status: "executing", zcode_execution_ref: null, started_at: NOW });
    expect(() => assertJobNeverExecutes(parseOrFail("ProductionJob", productionJobSchema, executing))).toThrow(
      InvariantViolation,
    );
  });

  test("graph engine refs opaque: validated graph needs resolved engine refs", () => {
    const draft = parseOrFail("ProductionGraph", productionGraphSchema, graphInput({
      nodes: [{ id: "n1", kind: "engine", ref: null, parameters: {} }],
    }));
    expect(() => assertGraphEngineRefsOpaque(draft)).not.toThrow();
    const validated = parseOrFail("ProductionGraph", productionGraphSchema, graphInput({
      status: "validated",
      nodes: [{ id: "n1", kind: "engine", ref: null, parameters: {} }],
      validated_at: NOW,
    }));
    expect(() => assertGraphEngineRefsOpaque(validated)).toThrow(/engine/);
  });

  test("experiment outcome: only concluded with evidence", () => {
    const bare = experimentInput({ outcome: "succeeded" });
    expect(() => assertExperimentOutcomeEvidence(parseOrFail("Experiment", experimentSchema, bare))).toThrow(
      /concluded/,
    );
    const noEvidence = experimentInput({
      status: "concluded",
      outcome: "succeeded",
      concluded_at: LATER,
    });
    expect(() => assertExperimentOutcomeEvidence(parseOrFail("Experiment", experimentSchema, noEvidence))).toThrow(
      /证据/,
    );
    const ok = experimentInput({
      status: "concluded",
      outcome: "succeeded",
      measurement_evidence_refs: ["ev-measure-1"],
      concluded_at: LATER,
    });
    expect(() => assertExperimentOutcomeEvidence(parseOrFail("Experiment", experimentSchema, ok))).not.toThrow();
  });

  test("distribution: executing/succeeded require approved preview binding", () => {
    const executing = intentInput({ status: "executing" });
    expect(() =>
      assertDistributionPreviewApproval(parseOrFail("DistributionIntent", distributionIntentSchema, executing)),
    ).toThrow(/预览/);
    const approved = intentInput({
      status: "executing",
      preview_ref: "preview-1",
      preview_hash: "sha256:abc",
      approval_state: "approved",
    });
    expect(() =>
      assertDistributionPreviewApproval(parseOrFail("DistributionIntent", distributionIntentSchema, approved)),
    ).not.toThrow();
    const notApproved = intentInput({
      status: "succeeded",
      preview_ref: "preview-1",
      preview_hash: "sha256:abc",
      approval_state: "pending",
    });
    expect(() =>
      assertDistributionPreviewApproval(parseOrFail("DistributionIntent", distributionIntentSchema, notApproved)),
    ).toThrow(/approved/);
  });
});
