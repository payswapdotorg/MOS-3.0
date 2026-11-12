import { describe, expect, test } from "vitest";
import {
  assertNoInferredMissionFields,
  ContractValidationError,
  InvariantViolation,
  missionSchema,
} from "@mos/contracts";
import { missionFromIntake } from "../src/index.js";
import type { MissionIntake } from "../src/index.js";

/**
 * 逐字 intake 矩阵（invariant §9：不得从营销简报推断缺失值）。
 * objective 一字不改；未提供的可选字段保持 null/[]；空白/空串 fail-closed。
 */

const NOW = "2026-11-12T00:00:00Z";

function baseIntake(overrides: Partial<MissionIntake> = {}): MissionIntake {
  return {
    tenant_id: "tenant-acme",
    workspace_id: "proj_work_acme",
    objective_verbatim:
      "Increase qualified inbound leads for our service business over the next 90 days.",
    source_zcode_session_id: null,
    source_zcode_task_id: null,
    target_audience: null,
    geography: null,
    desired_outcomes: [],
    success_metrics: [],
    budget: null,
    deadline: null,
    ...overrides,
  };
}

describe("missionFromIntake (verbatim, zero inference)", () => {
  test("objective is preserved verbatim (punctuation, case and spacing exact)", () => {
    const verbatim = "  Grow QUALIFIED pipeline—fast!! (Q4, EU-only)  ";
    const mission = missionFromIntake(baseIntake({ objective_verbatim: verbatim }), {
      now: NOW,
      id: "m-1",
    });
    expect(mission.objective).toBe(verbatim);
  });

  test("unknown optional fields stay null (never guessed)", () => {
    const mission = missionFromIntake(baseIntake(), { now: NOW, id: "m-1" });
    expect(mission.target_audience).toBeNull();
    expect(mission.geography).toBeNull();
    expect(mission.budget).toBeNull();
    expect(mission.deadline).toBeNull();
    expect(mission.desired_outcomes).toEqual([]);
    expect(mission.success_metrics).toEqual([]);
  });

  test("provided optional fields pass through exactly", () => {
    const mission = missionFromIntake(
      baseIntake({
        target_audience: "RevOps leaders",
        geography: "DE/AT/CH",
        desired_outcomes: ["+30% SQLs", "shorter cycle"],
        success_metrics: ["SQL count"],
        budget: { amount: "1500.00", currency: "EUR" },
        deadline: "2026-12-31T00:00:00Z",
      }),
      { now: NOW, id: "m-1" },
    );
    expect(mission.target_audience).toBe("RevOps leaders");
    expect(mission.geography).toBe("DE/AT/CH");
    expect(mission.desired_outcomes).toEqual(["+30% SQLs", "shorter cycle"]);
    expect(mission.success_metrics).toEqual(["SQL count"]);
    expect(mission.budget).toEqual({ amount: "1500.00", currency: "EUR" });
    expect(mission.deadline).toBe("2026-12-31T00:00:00Z");
  });

  test("constraints is always an empty object (intake has no constraints; nothing invented)", () => {
    const mission = missionFromIntake(baseIntake(), { now: NOW, id: "m-1" });
    expect(mission.constraints).toEqual({});
  });

  test("id/version/status/timestamps come from injected deps (active, version 1)", () => {
    const mission = missionFromIntake(baseIntake(), {
      now: NOW,
      id: "mos-mission-42",
    });
    expect(mission.id).toBe("mos-mission-42");
    expect(mission.version).toBe(1);
    expect(mission.status).toBe("active");
    expect(mission.created_at).toBe(NOW);
    expect(mission.updated_at).toBe(NOW);
  });

  test("zcode session/task references pass through verbatim", () => {
    const mission = missionFromIntake(
      baseIntake({
        source_zcode_session_id: "sess_demo",
        source_zcode_task_id: "sess_demo",
      }),
      { now: NOW, id: "m-1" },
    );
    expect(mission.source_zcode_session_id).toBe("sess_demo");
    expect(mission.source_zcode_task_id).toBe("sess_demo");
  });

  test("output validates against missionSchema and the no-inference guard", () => {
    const mission = missionFromIntake(baseIntake(), { now: NOW, id: "m-1" });
    expect(() => missionSchema.parse(mission)).not.toThrow();
    expect(() => assertNoInferredMissionFields(mission)).not.toThrow();
  });

  test("empty objective is rejected (contract minimum)", () => {
    expect(() =>
      missionFromIntake(baseIntake({ objective_verbatim: "" }), { now: NOW, id: "m-1" }),
    ).toThrow(ContractValidationError);
  });

  test("whitespace-only objective is rejected (no-inference guard)", () => {
    expect(() =>
      missionFromIntake(baseIntake({ objective_verbatim: "   " }), { now: NOW, id: "m-1" }),
    ).toThrow(InvariantViolation);
  });

  test("empty-string optional field is rejected (missing must be null, not empty string)", () => {
    expect(() =>
      missionFromIntake(baseIntake({ target_audience: "" }), { now: NOW, id: "m-1" }),
    ).toThrow(InvariantViolation);
  });
});
