import { describe, expect, test } from "vitest";
import { ContractValidationError } from "@mos/contracts";
import { compareExecutionOptions } from "../src/index.js";
import {
  engineOption,
  humanOption,
  machineOption,
  reuseOption,
} from "./fixtures.js";

describe("compareExecutionOptions (§8 route comparison, pure)", () => {
  test("adequate no-op/reuse option wins first (decision lock 17)", () => {
    const result = compareExecutionOptions([
      reuseOption({ adequacy: "adequate", inadequacy_reason: null }),
      machineOption({ adequacy: "adequate", inadequacy_reason: null }),
      humanOption(),
    ]);
    expect(result.recommendation).toBe("no_op_reuse");
    expect(result.humanAssignmentJustified).toBe(false);
  });

  test("adequate agent/engine option beats human offer", () => {
    const result = compareExecutionOptions([
      machineOption({ adequacy: "adequate", inadequacy_reason: null }),
      humanOption(),
    ]);
    expect(result.recommendation).toBe("agent_or_engine");
    expect(result.humanAssignmentJustified).toBe(false);
  });

  test("human only when every non-human option is not adequate and a human offer is adequate", () => {
    const result = compareExecutionOptions([
      machineOption(),
      engineOption({ adequacy: "inadequate", inadequacy_reason: "engine lacks rubric" }),
      reuseOption(),
      humanOption(),
    ]);
    expect(result.recommendation).toBe("human");
    expect(result.humanAssignmentJustified).toBe(true);
  });

  test("unknown adequacy never counts as adequate (decision lock 14)", () => {
    const result = compareExecutionOptions([
      machineOption({ adequacy: "unknown", inadequacy_reason: null }),
      engineOption({ adequacy: "unknown", inadequacy_reason: null }),
      reuseOption({ adequacy: "unknown", inadequacy_reason: null }),
      humanOption(),
    ]);
    expect(result.recommendation).toBe("human");
    expect(result.adequate).toHaveLength(1);
    expect(result.excluded.map((item) => item.reason)).toEqual([
      "adequacy unknown — never treated as adequate",
      "adequacy unknown — never treated as adequate",
      "adequacy unknown — never treated as adequate",
    ]);
  });

  test("empty comparison never defaults to human (fail-closed)", () => {
    const result = compareExecutionOptions([]);
    expect(result.recommendation).toBe("no_adequate_route");
    expect(result.humanAssignmentJustified).toBe(false);
  });

  test("no adequate option at all means no adequate route", () => {
    const result = compareExecutionOptions([machineOption(), reuseOption()]);
    expect(result.recommendation).toBe("no_adequate_route");
    expect(result.humanAssignmentJustified).toBe(false);
  });

  test("excluded options carry named reasons including the caller-supplied detail", () => {
    const result = compareExecutionOptions([
      machineOption({ inadequacy_reason: "no published agent offer covers 4k review" }),
      reuseOption({ inadequacy_reason: null, adequacy: "inadequate" }),
    ]);
    const reasons = result.excluded.map((item) => item.reason);
    expect(reasons[0]).toContain("no published agent offer covers 4k review");
    expect(reasons[1]).toBe("inadequate: no reason supplied");
  });

  test("unapproved options are excluded with named reason", () => {
    const result = compareExecutionOptions([
      reuseOption({ adequacy: "unapproved", inadequacy_reason: "rights gate denied" }),
    ]);
    expect(result.excluded[0]?.reason).toBe("unapproved: rights gate denied");
  });

  test("schema-invalid options fail closed with ContractValidationError", () => {
    expect(() => compareExecutionOptions([{ kind: "maybe", ref: "x", adequacy: "adequate" }])).toThrow(
      ContractValidationError,
    );
    expect(() =>
      compareExecutionOptions([humanOption({ estimated_cost: { amount: "1.2.3", currency: "USD" } })]),
    ).toThrow(ContractValidationError);
  });
});
