import { describe, expect, test } from "vitest";
import {
  assertDiscoverySurfacesExclusions,
  assertGigHumanAssignmentJustified,
  assertMarketIntelligenceEvidenced,
  assertPriceRecordImmutable,
  commerceProductSchema,
  executionOptionSchema,
  gigSchema,
  InvariantViolation,
  marketIntelligenceRecordSchema,
  moneySchema,
  networkNodeSchema,
  parseOrFail,
  priceRecordSchema,
  routeComparisonSchema,
} from "../src/index.js";

const NOW = "2026-11-14T12:00:00.000Z";
const LATER = "2026-11-14T18:00:00.000Z";

function nodeInput(overrides: Record<string, unknown> = {}) {
  return networkNodeSchema.parse({
    id: "node-1",
    tenant_id: "tenant-1",
    node_ref: { kind: "human", id: "agent-body-1" },
    display_name: "Specialist reviewer",
    evidenced_capability_ids: ["media.review"],
    availability: { windows: "weekdays 09-17 UTC", capacity: "2/day" },
    geography: "GH",
    language: "en",
    evidence_refs: ["ev-node-1"],
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function optionInput(overrides: Record<string, unknown> = {}) {
  return executionOptionSchema.parse({
    kind: "agent_offer",
    ref: "offer-agent-1",
    estimated_cost: { amount: "0.50", currency: "USD" },
    estimated_latency_ms: 5000,
    adequacy: "adequate",
    inadequacy_reason: null,
    ...overrides,
  });
}

function comparisonInput(overrides: Record<string, unknown> = {}) {
  return routeComparisonSchema.parse({
    compared_options: [
      optionInput({ kind: "agent_offer", ref: "offer-agent-1", adequacy: "inadequate", inadequacy_reason: "no published agent offer covers 4k review" }),
      optionInput({ kind: "engine", ref: "engine-1", adequacy: "unknown", inadequacy_reason: null }),
      optionInput({ kind: "no_op_reuse", ref: "route-reuse-1", adequacy: "unapproved", inadequacy_reason: "rights gate denied" }),
      optionInput({ kind: "human_offer", ref: "offer-human-1", adequacy: "adequate", estimated_cost: { amount: "25.00", currency: "USD" } }),
    ],
    recommendation: "human",
    evidence_refs: ["ev-compare-1"],
    compared_at: NOW,
    ...overrides,
  });
}

function gigInput(overrides: Record<string, unknown> = {}) {
  return gigSchema.parse({
    id: "gig-1",
    tenant_id: "tenant-1",
    mission_id: "m-1",
    objective: "Review final captions for regional compliance",
    source_refs: ["art-caption-v3"],
    script_brief: "Check each caption against the regional brief",
    capture_or_execution_instructions: "Annotate issues in the shared sheet",
    expected_output: "Reviewed sheet with per-caption verdicts",
    consent_rights: ["rights-record-1"],
    evaluator: { evaluator_ref: "eval-1", method: "per-item rubric" },
    deadline: LATER,
    budget_reward: { amount: "25.00", currency: "USD" },
    expected_value_of_waiting: { amount: "5.00", currency: "USD" },
    alternative_route_ids: ["route-1", "route-2"],
    route_comparison: null,
    assigned_node_ref: null,
    status: "draft",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function productInput(overrides: Record<string, unknown> = {}) {
  return commerceProductSchema.parse({
    id: "product-1",
    tenant_id: "tenant-1",
    name: "Launch content bundle",
    description: null,
    artifact_refs: ["art-1", "art-2"],
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function priceInput(overrides: Record<string, unknown> = {}) {
  return priceRecordSchema.parse({
    id: "price-1",
    tenant_id: "tenant-1",
    product_id: "product-1",
    price: { amount: "199.00", currency: "USD" },
    pricing_model: "subscription",
    effective_from: NOW,
    effective_until: null,
    superseded_by: null,
    evidence_refs: ["ev-price-1"],
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function intelligenceInput(overrides: Record<string, unknown> = {}) {
  return marketIntelligenceRecordSchema.parse({
    id: "intel-1",
    tenant_id: "tenant-1",
    topic: "segment price sensitivity",
    subject_ref: "segment-smb-gh",
    facts: { median_acceptable_price_usd: "149.00" },
    evidence_refs: ["ev-intel-1"],
    insight: "SMB segment tolerates up to 149 USD/mo",
    confidence: 0.72,
    limitations: ["sample size 40"],
    observed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

describe("W4 schemas", () => {
  test("NetworkNode accepts active registration with opaque node_ref", () => {
    const value = nodeInput();
    expect(value.node_ref.kind).toBe("human");
    expect(value.evidenced_capability_ids).toContain("media.review");
  });

  test("NetworkNode rejects empty display_name, bad kind and unknown status", () => {
    expect(() => nodeInput({ display_name: "" })).toThrow();
    expect(() => nodeInput({ node_ref: { kind: "robot", id: "x" } })).toThrow();
    expect(() => nodeInput({ status: "paused" })).toThrow();
  });

  test("Gig accepts draft Human Production Task Package without comparison", () => {
    const value = parseOrFail("Gig", gigSchema, gigInput());
    expect(value.status).toBe("draft");
    expect(value.route_comparison).toBeNull();
  });

  test("Gig rejects empty objective / bad status / non-money budget", () => {
    expect(() => gigInput({ objective: "" })).toThrow();
    expect(() => gigInput({ status: "open" })).toThrow();
    expect(() => gigInput({ budget_reward: { amount: "199", currency: "usd" } })).toThrow();
  });

  test("ExecutionOption accepts all four §8 option kinds; adequacy is fail-closed vocabulary", () => {
    for (const kind of ["human_offer", "agent_offer", "engine", "no_op_reuse"]) {
      expect(executionOptionSchema.parse(optionInput({ kind })).kind).toBe(kind);
    }
    expect(() => optionInput({ adequacy: "maybe" })).toThrow();
  });

  test("RouteComparison requires at least one compared option", () => {
    const value = parseOrFail("RouteComparison", routeComparisonSchema, comparisonInput());
    expect(value.compared_options.length).toBe(4);
    expect(() => comparisonInput({ compared_options: [] })).toThrow();
  });

  test("CommerceProduct accepts artifact lineage refs; rejects empty name and unknown status", () => {
    expect(productInput().artifact_refs).toContain("art-1");
    expect(() => productInput({ name: "" })).toThrow();
    expect(() => productInput({ status: "launched" })).toThrow();
  });

  test("PriceRecord accepts active subscription price; rejects bad money and unknown model", () => {
    const value = priceRecordSchema.parse(priceInput());
    expect(value.pricing_model).toBe("subscription");
    expect(() => priceInput({ price: { amount: "19.9.0", currency: "USD" } })).toThrow();
    expect(() => priceInput({ pricing_model: "freemium" })).toThrow();
  });

  test("MarketIntelligenceRecord accepts evidenced facts with opaque subject_ref", () => {
    const value = marketIntelligenceRecordSchema.parse(intelligenceInput());
    expect(value.subject_ref).toBe("segment-smb-gh");
    expect(value.evidence_refs).toContain("ev-intel-1");
  });

  test("moneySchema keeps decimal-string + ISO-4217 convention", () => {
    expect(moneySchema.parse({ amount: "-0.01", currency: "EUR" }).currency).toBe("EUR");
    expect(() => moneySchema.parse({ amount: "12", currency: "usd" })).toThrow();
    expect(() => moneySchema.parse({ amount: "1.2.3", currency: "USD" })).toThrow();
  });
});

describe("W4 invariants", () => {
  function assignedGig(overrides: Record<string, unknown> = {}) {
    return gigInput({
      status: "assigned",
      assigned_node_ref: { kind: "human", id: "agent-body-1" },
      route_comparison: comparisonInput(),
      ...overrides,
    });
  }

  test("gig §23: justified human assignment passes (machine+reuse compared, none adequate, evidenced)", () => {
    const gig = parseOrFail("Gig", gigSchema, assignedGig());
    expect(() => assertGigHumanAssignmentJustified(gig)).not.toThrow();
  });

  test("gig §23: assignment without comparison / missing §8 disclosures fails closed", () => {
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ route_comparison: null })),
      ),
    ).toThrow(/route_comparison/);
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ deadline: null })),
      ),
    ).toThrow(/deadline/);
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ budget_reward: null })),
      ),
    ).toThrow(/budget_reward/);
  });

  test("gig §23: comparison missing a candidate class fails closed with named class", () => {
    const noReuse = comparisonInput({
      compared_options: comparisonInput().compared_options.filter((o) => o.kind !== "no_op_reuse"),
    });
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ route_comparison: noReuse })),
      ),
    ).toThrow(/no-op\/reuse/);
  });

  test("gig §23: an adequate agent/engine or reuse option blocks human assignment", () => {
    const withAdequateEngine = comparisonInput({
      compared_options: comparisonInput().compared_options.map((o) =>
        o.kind === "engine" ? { ...o, adequacy: "adequate" } : o,
      ),
    });
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ route_comparison: withAdequateEngine })),
      ),
    ).toThrow(InvariantViolation);
  });

  test("gig §23: unknown adequacy never counts as adequate; unevidenced comparison fails closed", () => {
    const allUnknown = comparisonInput({
      compared_options: comparisonInput().compared_options.map((o) =>
        o.kind === "human_offer" ? o : { ...o, adequacy: "unknown", inadequacy_reason: null },
      ),
    });
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail("Gig", gigSchema, assignedGig({ route_comparison: allUnknown })),
      ),
    ).not.toThrow();
    expect(() =>
      assertGigHumanAssignmentJustified(
        parseOrFail(
          "Gig",
          gigSchema,
          assignedGig({ route_comparison: comparisonInput({ evidence_refs: [] }) }),
        ),
      ),
    ).toThrow(/证据/);
  });

  test("gig §23: non-human assignment and pre-assignment statuses are out of scope", () => {
    const machine = parseOrFail(
      "Gig",
      gigSchema,
      assignedGig({ assigned_node_ref: { kind: "agent", id: "agent-body-2" }, route_comparison: null }),
    );
    expect(() => assertGigHumanAssignmentJustified(machine)).not.toThrow();
    const rejected = parseOrFail(
      "Gig",
      gigSchema,
      assignedGig({ status: "rejected", route_comparison: null }),
    );
    expect(() => assertGigHumanAssignmentJustified(rejected)).not.toThrow();
    const draft = parseOrFail("Gig", gigSchema, gigInput());
    expect(() => assertGigHumanAssignmentJustified(draft)).not.toThrow();
  });

  test("price §24: amount/model/window immutability enforced; status/updated_at may change", () => {
    const before = priceRecordSchema.parse(priceInput());
    const statusFlip = priceRecordSchema.parse(priceInput({ status: "retired", updated_at: LATER }));
    expect(() => assertPriceRecordImmutable(before, statusFlip)).not.toThrow();
    expect(() =>
      assertPriceRecordImmutable(
        before,
        priceRecordSchema.parse(priceInput({ price: { amount: "299.00", currency: "USD" } })),
      ),
    ).toThrow(/price\.amount/);
    expect(() =>
      assertPriceRecordImmutable(before, priceRecordSchema.parse(priceInput({ pricing_model: "one_time" }))),
    ).toThrow(/pricing_model/);
    expect(() =>
      assertPriceRecordImmutable(
        before,
        priceRecordSchema.parse(priceInput({ effective_until: LATER })),
      ),
    ).toThrow(/effective_until/);
  });

  test("intelligence §25: empty evidence fails closed; evidenced record passes", () => {
    expect(() =>
      assertMarketIntelligenceEvidenced(
        marketIntelligenceRecordSchema.parse(intelligenceInput()),
      ),
    ).not.toThrow();
    expect(() =>
      assertMarketIntelligenceEvidenced(
        marketIntelligenceRecordSchema.parse(intelligenceInput({ evidence_refs: [] })),
      ),
    ).toThrow(InvariantViolation);
  });

  test("discovery §26: excluded candidates must carry named reasons", () => {
    expect(() =>
      assertDiscoverySurfacesExclusions([
        { ref: "offer-1", reason: "withdrawn" },
        { ref: "node-2", reason: "inactive" },
      ]),
    ).not.toThrow();
    expect(() =>
      assertDiscoverySurfacesExclusions([{ ref: "offer-1", reason: "  " }]),
    ).toThrow(/offer-1/);
    expect(() =>
      assertDiscoverySurfacesExclusions([{ ref: "offer-1", reason: "" }]),
    ).toThrow(InvariantViolation);
  });
});
