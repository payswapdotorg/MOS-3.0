import { describe, expect, test } from "vitest";
import {
  assertHypothesisCarriesNoOutcome,
  assertNodeOfferPublishable,
  assertResearchFindingEvidence,
  assertTenantScope,
  InvariantViolation,
  parseOrFail,
  nodeOfferSchema,
  hypothesisSchema,
} from "../src/index.js";

const NOW = "2026-11-13T00:00:00.000Z";

function offerWith(overrides: Record<string, unknown>): ReturnType<typeof parseOffer> {
  return parseOffer({
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
    ...overrides,
  });
}

function parseOffer(input: unknown): ReturnType<typeof nodeOfferSchema.parse> {
  return nodeOfferSchema.parse(input);
}

function hypothesisWith(overrides: Record<string, unknown>): ReturnType<typeof hypothesisSchema.parse> {
  return hypothesisSchema.parse({
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
    ...overrides,
  });
}

describe("offer publish gate (invariants: §8 disclosure)", () => {
  test("a fully disclosed offer may be published", () => {
    expect(() => offerWith({ status: "published" })).not.toThrow();
  });

  test("missing disclosure keeps the offer publish-rejected with named fields", () => {
    const offer = offerWith({ status: "published", geography: null, sla: null });
    try {
      assertNodeOfferPublishable(offer);
      expect.unreachable("publish gate must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(InvariantViolation);
      const message = (error as InvariantViolation).message;
      expect(message).toContain("geography");
      expect(message).toContain("sla");
    }
  });

  test("draft offers are never gate-checked (unknowns stay explicit)", () => {
    const draft = offerWith({ status: "draft", geography: null, price_reward: null });
    expect(() => assertNodeOfferPublishable(draft)).not.toThrow();
  });

  test("empty availability disclosure blocks publication", () => {
    const offer = offerWith({
      status: "published",
      availability: { windows: null, capacity: null },
    });
    expect(() => assertNodeOfferPublishable(offer)).toThrow(InvariantViolation);
  });
});

describe("hypothesis outcome boundary (decision lock 18)", () => {
  test("a proposal without experiment_ref carries no outcome", () => {
    expect(() => assertHypothesisCarriesNoOutcome(hypothesisWith({}))).not.toThrow();
  });

  test("experiment_ref without adopted_by_experiment status is rejected", () => {
    const hypothesis = hypothesisWith({ experiment_ref: "exp-1", status: "proposed" });
    expect(() => assertHypothesisCarriesNoOutcome(hypothesis)).toThrow(InvariantViolation);
  });

  test("adopted_by_experiment requires an opaque experiment_ref", () => {
    const adopted = hypothesisWith({ status: "adopted_by_experiment", experiment_ref: "exp-1" });
    expect(() => assertHypothesisCarriesNoOutcome(adopted)).not.toThrow();
    const missing = hypothesisWith({ status: "adopted_by_experiment", experiment_ref: null });
    expect(() => assertHypothesisCarriesNoOutcome(missing)).toThrow(InvariantViolation);
  });
});

describe("research finding evidence boundary", () => {
  test("findings must reference existing evidence", () => {
    expect(() =>
      assertResearchFindingEvidence(
        { evidence_ref: "ev-missing", statement: "s" },
        undefined,
      ),
    ).toThrow(InvariantViolation);
  });

  test("simulation evidence may not back a provider-observation finding", () => {
    expect(() =>
      assertResearchFindingEvidence(
        { evidence_ref: "ev-sim", statement: "s" },
        { kind: "simulation" },
      ),
    ).toThrow(/simulation/);
  });

  test("provider_response evidence is accepted", () => {
    expect(() =>
      assertResearchFindingEvidence(
        { evidence_ref: "ev-1", statement: "s" },
        { kind: "provider_response" },
      ),
    ).not.toThrow();
  });
});

describe("tenant scope isolation", () => {
  test("cross-tenant access fails closed with the record kind named", () => {
    const record = { tenant_id: "tenant-a", id: "offer-1" };
    expect(() => assertTenantScope(record, { tenant_id: "tenant-b" }, "NodeOffer")).toThrow(
      /NodeOffer/,
    );
  });

  test("same-tenant access passes", () => {
    const record = { tenant_id: "tenant-a", id: "offer-1" };
    expect(() =>
      assertTenantScope(record, { tenant_id: "tenant-a" }, "NodeOffer"),
    ).not.toThrow();
  });
});
