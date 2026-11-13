import { describe, expect, test } from "vitest";
import {
  agentBodySchema,
  hypothesisSchema,
  nodeOfferSchema,
  nodeRefSchema,
  organizationSchema,
  parseOrFail,
  researchNoteSchema,
} from "../src/index.js";

const NOW = "2026-11-13T00:00:00.000Z";

function expectInvalid(schema: Parameters<typeof parseOrFail>[1], input: unknown): void {
  const result = schema.safeParse(input);
  expect(result.success, JSON.stringify(input)).toBe(false);
}

const agentBodyInput = {
  id: "body-1",
  tenant_id: "tenant-1",
  kind: "agent",
  display_name: "Copy agent",
  organization_id: null,
  role: "copywriter",
  evidenced_capability_ids: [],
  status: "active",
  created_at: NOW,
  updated_at: NOW,
};

const organizationInput = {
  id: "org-1",
  tenant_id: "tenant-1",
  name: "Example org",
  description: null,
  status: "active",
  created_at: NOW,
  updated_at: NOW,
};

const offerInput = {
  id: "offer-1",
  tenant_id: "tenant-1",
  node_ref: { kind: "agent", id: "body-1" },
  capability_id: "cap-1",
  inputs: ["brief"],
  deliverables: ["draft copy"],
  availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: "2 concurrent" },
  geography: "global",
  language: "en",
  price_reward: { amount: "120.00", currency: "USD" },
  deadline: null,
  sla: "48h first draft",
  rights_constraints: ["work-for-hire"],
  acceptance_evaluator: { evaluator_ref: "eval-1", method: "human review panel" },
  evidence_refs: ["spec/example-evidence.md"],
  delivery_history: [],
  status: "draft",
  created_at: NOW,
  updated_at: NOW,
};

const researchNoteInput = {
  id: "note-1",
  tenant_id: "tenant-1",
  mission_id: null,
  topic: "competitor pricing pages",
  findings: [{ evidence_ref: "ev-1", statement: "Three competitors publish pricing." }],
  insight: "transparent pricing is table stakes in this segment",
  confidence: 0.4,
  limitations: ["sample covers three competitors only"],
  created_at: NOW,
  updated_at: NOW,
};

const hypothesisInput = {
  id: "hyp-1",
  tenant_id: "tenant-1",
  mission_id: "m-1",
  statement: "Publishing pricing increases qualified inbound leads.",
  rationale: null,
  evidence_refs: ["ev-1"],
  proposed_route_ids: [],
  status: "proposed",
  experiment_ref: null,
  created_at: NOW,
  updated_at: NOW,
};

describe("AgentBody / Organization / NodeRef", () => {
  test("AgentBody accepts required fields with explicit nulls", () => {
    const value = parseOrFail("AgentBody", agentBodySchema, agentBodyInput);
    expect(value.status).toBe("active");
  });

  test("AgentBody rejects unknown kind and empty display_name", () => {
    expectInvalid(agentBodySchema, { ...agentBodyInput, kind: "unicorn" });
    expectInvalid(agentBodySchema, { ...agentBodyInput, display_name: "" });
  });

  test("Organization accepts required fields", () => {
    expect(parseOrFail("Organization", organizationSchema, organizationInput).name).toBe(
      "Example org",
    );
  });

  test("Organization rejects missing status", () => {
    const { status: _status, ...withoutStatus } = organizationInput;
    expectInvalid(organizationSchema, withoutStatus);
  });

  test("NodeRef rejects empty ids and unknown kinds", () => {
    expect(nodeOfferSchema.safeParse(offerInput).success).toBe(true);
    expectInvalid(nodeRefSchema, { kind: "human", id: "" });
    expectInvalid(nodeRefSchema, { kind: "unknown-node", id: "x" });
  });
});

describe("NodeOffer", () => {
  test("accepts a fully disclosed draft offer", () => {
    const value = parseOrFail("NodeOffer", nodeOfferSchema, offerInput);
    expect(value.status).toBe("draft");
    expect(value.price_reward?.currency).toBe("USD");
  });

  test("rejects invalid money shape and non-UTC timestamps", () => {
    expectInvalid(nodeOfferSchema, {
      ...offerInput,
      price_reward: { amount: "12.5.1", currency: "USD" },
    });
    expectInvalid(nodeOfferSchema, { ...offerInput, deadline: "2026-11-13T00:00:00+01:00" });
  });

  test("rejects offers missing the §8 evaluator disclosure", () => {
    const { acceptance_evaluator: _evaluator, ...withoutEvaluator } = offerInput;
    expectInvalid(nodeOfferSchema, withoutEvaluator);
  });
});

describe("ResearchNote / Hypothesis", () => {
  test("ResearchNote accepts evidence-linked findings with explicit confidence", () => {
    const value = parseOrFail("ResearchNote", researchNoteSchema, researchNoteInput);
    expect(value.findings[0]?.evidence_ref).toBe("ev-1");
  });

  test("ResearchNote rejects empty finding statements and out-of-range confidence", () => {
    expectInvalid(researchNoteSchema, {
      ...researchNoteInput,
      findings: [{ evidence_ref: "ev-1", statement: "" }],
    });
    expectInvalid(researchNoteSchema, { ...researchNoteInput, confidence: 1.5 });
  });

  test("Hypothesis accepts a proposal without any outcome semantics", () => {
    const value = parseOrFail("Hypothesis", hypothesisSchema, hypothesisInput);
    expect(value.status).toBe("proposed");
    expect(value.experiment_ref).toBeNull();
  });

  test("Hypothesis rejects outcome-like status vocabulary", () => {
    expectInvalid(hypothesisSchema, { ...hypothesisInput, status: "validated" });
    expectInvalid(hypothesisSchema, { ...hypothesisInput, status: "succeeded" });
  });

  test("Hypothesis requires mission linkage", () => {
    const { mission_id: _mission, ...withoutMission } = hypothesisInput;
    expectInvalid(hypothesisSchema, withoutMission);
  });
});
