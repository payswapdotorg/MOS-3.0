import { describe, expect, test } from "vitest";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  applyGigTransition,
  assignGig,
  gigFromInput,
  isLegalGigTransition,
  LEGAL_GIG_TRANSITIONS,
  materializeAssignment,
  missingGigAssignmentJustification,
  missingGigPackageDisclosures,
  publishGig,
} from "../src/index.js";
import {
  GigAssignmentBlockedError,
  GigPublishBlockedError,
  GigTransitionError,
  GigValidationError,
  RouteComparisonValidationError,
} from "../src/index.js";
import {
  AGENT_NODE_REF,
  draftGig,
  gigIntake,
  justifiedComparison,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";
import type { Gig, GigStatus } from "@mos/contracts";

describe("gigFromInput (creation is always draft, comparison-free, unassigned)", () => {
  test("forces status=draft, no comparison, no assignment", () => {
    const gig = gigFromInput(gigIntake(), { id: "gig-1", now: T1 });
    expect(gig.status).toBe("draft");
    expect(gig.route_comparison).toBeNull();
    expect(gig.assigned_node_ref).toBeNull();
    expect(gig.objective).toBe("Review final captions for regional compliance");
  });

  test("schema-invalid intake fails closed with ContractValidationError", () => {
    expect(() => gigFromInput(gigIntake({ objective: "" }), { id: "gig-1", now: T1 })).toThrow(
      ContractValidationError,
    );
    expect(() =>
      gigFromInput(gigIntake({ evaluator: { evaluator_ref: "", method: "x" } }), {
        id: "gig-1",
        now: T1,
      }),
    ).toThrow(ContractValidationError);
  });

  test("input is never mutated", () => {
    const input = gigIntake();
    gigFromInput(input, { id: "gig-1", now: T1 });
    expect(input.tenant_id).toBe(TENANT);
    expect(Object.keys(input)).toContain("objective");
  });
});

describe("missingGigPackageDisclosures (§8 completeness gate, pure)", () => {
  test("complete package has no missing disclosures", () => {
    expect(missingGigPackageDisclosures(draftGig())).toEqual([]);
  });

  test("null deadline/budget/evw and empty alternative routes are named missing", () => {
    const gig = draftGig({
      deadline: null,
      budget_reward: null,
      expected_value_of_waiting: null,
      alternative_route_ids: [],
    });
    expect(missingGigPackageDisclosures(gig)).toEqual([
      "deadline",
      "budget_reward",
      "expected_value_of_waiting",
      "alternative_route_ids",
    ]);
  });
});

describe("publishGig (draft -> published, §8 completeness gate)", () => {
  test("publishes a complete package", () => {
    const published = publishGig(draftGig(), { now: T2 });
    expect(published.status).toBe("published");
    expect(published.updated_at).toBe(T2);
  });

  test("incomplete package stays in draft with named missing disclosures", () => {
    const incomplete = draftGig({ deadline: null, alternative_route_ids: [] });
    expect(() => publishGig(incomplete, { now: T2 })).toThrow(GigPublishBlockedError);
    try {
      publishGig(incomplete, { now: T2 });
    } catch (error) {
      if (error instanceof GigPublishBlockedError) {
        expect(error.missingDisclosures).toEqual(["deadline", "alternative_route_ids"]);
      } else {
        throw error;
      }
    }
  });

  test("only draft can publish", () => {
    expect(() => publishGig(publishGig(draftGig(), { now: T2 }), { now: T2 })).toThrow(
      GigTransitionError,
    );
  });
});

describe("materializeAssignment (loose input -> strict NodeRef + RouteComparison)", () => {
  test("materializes a valid comparison", () => {
    const assignment = materializeAssignment({
      assigned_node_ref: { kind: "human", id: "agent-body-1" },
      route_comparison: justifiedComparison(),
    });
    expect(assignment.assigned_node_ref.kind).toBe("human");
    expect(assignment.route_comparison?.compared_options).toHaveLength(4);
  });

  test("comparison may be omitted (null) for non-human assignment", () => {
    const assignment = materializeAssignment({
      assigned_node_ref: { kind: "agent", id: "agent-body-2" },
    });
    expect(assignment.route_comparison).toBeNull();
  });

  test("invalid node ref / comparison fail closed with typed errors", () => {
    expect(() => materializeAssignment({ assigned_node_ref: { kind: "robot", id: "x" } })).toThrow(
      ContractValidationError,
    );
    expect(() =>
      materializeAssignment({
        assigned_node_ref: { kind: "human", id: "agent-body-1" },
        route_comparison: { compared_options: [], recommendation: "human", compared_at: T1 },
      }),
    ).toThrow(RouteComparisonValidationError);
  });
});

describe("assignGig (published -> assigned, §23 human-assignment gate)", () => {
  function published(): Gig {
    return publishGig(draftGig(), { now: T2 });
  }

  test("non-human assignment needs no route comparison", () => {
    const next = assignGig(
      published(),
      materializeAssignment({ assigned_node_ref: AGENT_NODE_REF }),
      { now: T2 },
    );
    expect(next.status).toBe("assigned");
    expect(next.assigned_node_ref).toEqual(AGENT_NODE_REF);
  });

  test("justified human assignment passes (machine+reuse compared, none adequate, evidenced)", () => {
    const next = assignGig(
      published(),
      materializeAssignment({
        assigned_node_ref: { kind: "human", id: "agent-body-1" },
        route_comparison: justifiedComparison(),
      }),
      { now: T2 },
    );
    expect(next.status).toBe("assigned");
    expect(next.route_comparison?.recommendation).toBe("human");
  });

  test("human assignment without comparison is blocked with named missing items", () => {
    expect(() =>
      assignGig(
        published(),
        materializeAssignment({ assigned_node_ref: { kind: "human", id: "agent-body-1" } }),
        { now: T2 },
      ),
    ).toThrow(GigAssignmentBlockedError);
    try {
      assignGig(
        published(),
        materializeAssignment({ assigned_node_ref: { kind: "human", id: "agent-body-1" } }),
        { now: T2 },
      );
    } catch (error) {
      if (error instanceof GigAssignmentBlockedError) {
        expect(error.missing).toContain("route_comparison");
      } else {
        throw error;
      }
    }
  });

  test("comparison missing a candidate class is blocked (agent/engine, no-op/reuse, human)", () => {
    const missingReuse = {
      ...justifiedComparison(),
      compared_options: justifiedComparison().compared_options.filter(
        (option) => option.kind !== "no_op_reuse",
      ),
    };
    expect(() =>
      assignGig(
        published(),
        materializeAssignment({
          assigned_node_ref: { kind: "human", id: "agent-body-1" },
          route_comparison: missingReuse,
        }),
        { now: T2 },
      ),
    ).toThrow(/no-op\/reuse compared option/);
  });

  test("an adequate non-human option blocks human assignment (do-not-assign-by-default)", () => {
    const withAdequateMachine = {
      ...justifiedComparison(),
      compared_options: justifiedComparison().compared_options.map((option) =>
        option.kind === "agent_offer" ? { ...option, adequacy: "adequate" } : option,
      ),
    };
    expect(() =>
      assignGig(
        published(),
        materializeAssignment({
          assigned_node_ref: { kind: "human", id: "agent-body-1" },
          route_comparison: withAdequateMachine,
        }),
        { now: T2 },
      ),
    ).toThrow(/adequate non-human route remains/);
  });

  test("unknown adequacy never justifies blocking; unevidenced comparison is blocked", () => {
    const unknownAdequacy = {
      ...justifiedComparison(),
      compared_options: justifiedComparison().compared_options.map((option) =>
        option.kind === "human_offer" ? option : { ...option, adequacy: "unknown" },
      ),
    };
    expect(() =>
      assignGig(
        published(),
        materializeAssignment({
          assigned_node_ref: { kind: "human", id: "agent-body-1" },
          route_comparison: unknownAdequacy,
        }),
        { now: T2 },
      ),
    ).not.toThrow();

    const unevidenced = { ...justifiedComparison(), evidence_refs: [] };
    expect(() =>
      assignGig(
        published(),
        materializeAssignment({
          assigned_node_ref: { kind: "human", id: "agent-body-1" },
          route_comparison: unevidenced,
        }),
        { now: T2 },
      ),
    ).toThrow(/route_comparison evidence refs/);
  });

  test("only published gigs can be assigned", () => {
    expect(() =>
      assignGig(draftGig(), materializeAssignment({ assigned_node_ref: AGENT_NODE_REF }), { now: T2 }),
    ).toThrow(GigTransitionError);
  });
});

describe("missingGigAssignmentJustification (pure gate, mirrors §23 guard)", () => {
  test("non-human assignments need no justification", () => {
    const gig = draftGig({ assigned_node_ref: AGENT_NODE_REF, status: "assigned" });
    expect(missingGigAssignmentJustification(gig)).toEqual([]);
  });

  test("human assignment missing everything lists package disclosures first", () => {
    const gig = draftGig({
      assigned_node_ref: { kind: "human", id: "agent-body-1" },
      status: "assigned",
      deadline: null,
    });
    const missing = missingGigAssignmentJustification(gig);
    expect(missing).toContain("deadline");
    expect(missing).toContain("route_comparison");
  });
});

describe("applyGigTransition (generic state machine)", () => {
  function assignedToAgent(): Gig {
    return assignGig(
      publishGig(draftGig(), { now: T2 }),
      materializeAssignment({ assigned_node_ref: AGENT_NODE_REF }),
      { now: T2 },
    );
  }

  test("full legal chain assigned -> in_progress -> delivered -> accepted", () => {
    let gig = assignedToAgent();
    gig = applyGigTransition(gig, "in_progress", { now: T2 });
    gig = applyGigTransition(gig, "delivered", { now: T2 });
    gig = applyGigTransition(gig, "accepted", { now: T2 });
    expect(gig.status).toBe("accepted");
    expect(() => applyGigTransition(gig, "in_progress", { now: T2 })).toThrow(GigTransitionError);
  });

  test("rejected is legal from delivered only", () => {
    let gig = assignedToAgent();
    expect(() => applyGigTransition(gig, "rejected", { now: T2 })).toThrow(GigTransitionError);
    gig = applyGigTransition(gig, "in_progress", { now: T2 });
    gig = applyGigTransition(gig, "delivered", { now: T2 });
    expect(applyGigTransition(gig, "rejected", { now: T2 }).status).toBe("rejected");
  });

  test("cancelled is legal from every non-terminal pre-delivery state", () => {
    for (const status of ["draft", "published", "assigned", "in_progress"] as GigStatus[]) {
      expect(isLegalGigTransition(status, "cancelled")).toBe(true);
    }
    for (const status of ["delivered", "accepted", "rejected", "cancelled"] as GigStatus[]) {
      expect(isLegalGigTransition(status, "cancelled")).toBe(false);
    }
  });

  test("unknown status has no outgoing transitions (fail-closed)", () => {
    expect(LEGAL_GIG_TRANSITIONS.unknown).toEqual([]);
    expect(() =>
      applyGigTransition(draftGig({ status: "unknown" }), "published", { now: T2 }),
    ).toThrow(GigTransitionError);
  });

  test("publish/assign targets refuse the generic path (they own gates)", () => {
    expect(() => applyGigTransition(draftGig(), "published", { now: T2 })).toThrow(GigValidationError);
    expect(() => applyGigTransition(publishGig(draftGig(), { now: T2 }), "assigned", { now: T2 })).toThrow(
      GigValidationError,
    );
  });

  test("transitioning a human-assigned gig never drops the justification (defense in depth)", () => {
    const gig = assignGig(
      publishGig(draftGig(), { now: T2 }),
      materializeAssignment({
        assigned_node_ref: { kind: "human", id: "agent-body-1" },
        route_comparison: justifiedComparison(),
      }),
      { now: T2 },
    );
    const handCorrupted: Gig = { ...gig, route_comparison: null };
    expect(() => applyGigTransition(handCorrupted, "in_progress", { now: T2 })).toThrow(
      InvariantViolation,
    );
  });
});
