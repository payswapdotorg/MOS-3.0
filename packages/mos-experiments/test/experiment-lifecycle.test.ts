import { describe, expect, test } from "vitest";
import { ContractValidationError } from "@mos/contracts";
import {
  applyExperimentTransition,
  concludeExperiment,
  experimentFromInput,
  isLegalExperimentTransition,
  LEGAL_EXPERIMENT_TRANSITIONS,
} from "../src/index.js";
import {
  ExperimentTransitionError,
  OutcomeEvidenceRequiredError,
} from "../src/index.js";
import type { Experiment } from "@mos/contracts";
import {
  ASSIGNMENT_RECORD,
  baseInput,
  CONCLUDED_AT,
  EVIDENCE_REF,
  EVIDENCE_REF_2,
  handBuiltExperiment,
  T1,
  T2,
  T3,
} from "./fixtures.js";

/**
 * Experiment 生命周期矩阵（纯 domain，零 I/O）：
 * 全链 happy path（outcome + evidence）、无证据收尾拒绝、未收尾写结果拒绝、
 * cancelled 终态、跳态/回退/直接 concluded 拒绝。
 */

/** defined → assigned → measuring → analyzed 的合法前缀。 */
function runToAnalyzed(): Experiment {
  const defined = experimentFromInput(baseInput(), { now: T1, id: "exp-1" });
  const assigned = applyExperimentTransition(
    defined,
    { target: "assigned", assignment: ASSIGNMENT_RECORD },
    { now: T2 },
  );
  const measuring = applyExperimentTransition(assigned, { target: "measuring" }, { now: T3 });
  return applyExperimentTransition(measuring, { target: "analyzed" }, { now: T3 });
}

function concludeInput(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "succeeded" as const,
    outcome_note: null,
    evidence_refs: [EVIDENCE_REF, EVIDENCE_REF_2],
    concluded_at: CONCLUDED_AT,
    ...overrides,
  };
}

/** 捕获 ExperimentTransitionError 的具名 current/target（未抛错则 undefined）。 */
function capture(
  run: () => unknown,
): InstanceType<typeof ExperimentTransitionError> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ExperimentTransitionError) return error;
    throw error;
  }
  return undefined;
}

describe("experimentFromInput (creation cannot express outcomes)", () => {
  test("forces status=defined with all result fields null/empty", () => {
    const experiment = experimentFromInput(baseInput(), { now: T1, id: "exp-new" });
    expect(experiment.status).toBe("defined");
    expect(experiment.assignment).toBeNull();
    expect(experiment.measurement_evidence_refs).toEqual([]);
    expect(experiment.outcome).toBeNull();
    expect(experiment.outcome_note).toBeNull();
    expect(experiment.started_at).toBeNull();
    expect(experiment.concluded_at).toBeNull();
    expect(experiment.hypothesis_id).toBeNull();
    expect(experiment.created_at).toBe(T1);
  });

  test("absent nullable refs stay null; statement/design copied verbatim", () => {
    const experiment = experimentFromInput(
      baseInput({
        mission_id: null,
        hypothesis_id: null,
        design: { note: "  keep  spaces  " },
      }),
      { now: T1, id: "exp-min" },
    );
    expect(experiment.mission_id).toBeNull();
    expect(experiment.hypothesis_id).toBeNull();
    expect(experiment.design).toEqual({ note: "  keep  spaces  " });
  });

  test("schema-invalid input fails closed with ContractValidationError", () => {
    expect(() =>
      experimentFromInput(baseInput({ statement: "" }), { now: T1, id: "exp-bad" }),
    ).toThrow(ContractValidationError);
    expect(() =>
      experimentFromInput(baseInput({ tenant_id: "" }), { now: T1, id: "exp-bad" }),
    ).toThrow(ContractValidationError);
  });
});

describe("full lifecycle happy path (defined → … → concluded with outcome + evidence)", () => {
  test("assigned requires and stores the assignment record; measuring records started_at", () => {
    const defined = experimentFromInput(baseInput(), { now: T1, id: "exp-1" });

    const assigned = applyExperimentTransition(
      defined,
      { target: "assigned", assignment: ASSIGNMENT_RECORD },
      { now: T2 },
    );
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignment).toEqual(ASSIGNMENT_RECORD);
    expect(defined.assignment).toBeNull(); // 纯函数：原记录不被变异

    const measuring = applyExperimentTransition(assigned, { target: "measuring" }, { now: T3 });
    expect(measuring.status).toBe("measuring");
    expect(measuring.started_at).toBe(T3);

    const analyzed = applyExperimentTransition(measuring, { target: "analyzed" }, { now: T3 });
    expect(analyzed.status).toBe("analyzed");
    expect(analyzed.started_at).toBe(T3); // 只补不覆盖
  });

  test("concluded carries outcome, evidence refs and concluded_at", () => {
    const concluded = concludeExperiment(
      runToAnalyzed(),
      concludeInput({ outcome: "inconclusive", outcome_note: "Underpowered sample." }),
      { now: CONCLUDED_AT },
    );
    expect(concluded.status).toBe("concluded");
    expect(concluded.outcome).toBe("inconclusive");
    expect(concluded.outcome_note).toBe("Underpowered sample.");
    expect(concluded.measurement_evidence_refs).toEqual([EVIDENCE_REF, EVIDENCE_REF_2]);
    expect(concluded.concluded_at).toBe(CONCLUDED_AT);
    expect(concluded.updated_at).toBe(CONCLUDED_AT);
  });

  test("succeeded and failed outcomes are both writable through the conclude path", () => {
    for (const outcome of ["succeeded", "failed"] as const) {
      const concluded = concludeExperiment(
        runToAnalyzed(),
        concludeInput({ outcome }),
        { now: CONCLUDED_AT },
      );
      expect(concluded.outcome).toBe(outcome);
    }
  });
});

describe("conclude gates (no outcome without evidence, no outcome before concluded)", () => {
  test("conclude without measurement evidence fails closed (OutcomeEvidenceRequiredError)", () => {
    const error = (() => {
      try {
        concludeExperiment(runToAnalyzed(), concludeInput({ evidence_refs: [] }), {
          now: CONCLUDED_AT,
        });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(OutcomeEvidenceRequiredError);
    expect((error as OutcomeEvidenceRequiredError).missing).toEqual([
      "measurement_evidence_refs",
    ]);
  });

  test("conclude from a non-analyzed status is rejected (outcome before concluded)", () => {
    for (const experiment of [
      experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
      applyExperimentTransition(
        experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
        { target: "assigned", assignment: ASSIGNMENT_RECORD },
        { now: T2 },
      ),
      applyExperimentTransition(
        applyExperimentTransition(
          experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
          { target: "assigned", assignment: ASSIGNMENT_RECORD },
          { now: T2 },
        ),
        { target: "measuring" },
        { now: T3 },
      ),
    ]) {
      const error = capture(() =>
        concludeExperiment(experiment, concludeInput(), { now: CONCLUDED_AT }),
      );
      expect(error?.target).toBe("concluded");
    }
  });

  test("invalid conclude input fails closed with ContractValidationError", () => {
    expect(() =>
      concludeExperiment(
        runToAnalyzed(),
        concludeInput({ outcome: "smashed" as never }),
        { now: CONCLUDED_AT },
      ),
    ).toThrow(ContractValidationError);
    expect(() =>
      concludeExperiment(runToAnalyzed(), concludeInput({ concluded_at: "yesterday" }), {
        now: CONCLUDED_AT,
      }),
    ).toThrow(ContractValidationError);
  });
});

describe("illegal transitions (skip / backtrack / direct concluded / terminals)", () => {
  test("skipping states is rejected with named current/target", () => {
    const defined = experimentFromInput(baseInput(), { now: T1, id: "exp-1" });
    const skip1 = capture(() =>
      applyExperimentTransition(defined, { target: "measuring" }, { now: T2 }),
    );
    expect(skip1?.current).toBe("defined");
    expect(skip1?.target).toBe("measuring");

    const skip2 = capture(() =>
      applyExperimentTransition(defined, { target: "analyzed" }, { now: T2 }),
    );
    expect(skip2?.current).toBe("defined");
    expect(skip2?.target).toBe("analyzed");
  });

  test("backtracking is rejected (measuring→assigned, analyzed→measuring)", () => {
    const assigned = applyExperimentTransition(
      experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
      { target: "assigned", assignment: ASSIGNMENT_RECORD },
      { now: T2 },
    );
    const measuring = applyExperimentTransition(assigned, { target: "measuring" }, { now: T3 });
    expect(() =>
      applyExperimentTransition(
        measuring,
        { target: "assigned", assignment: {} },
        { now: T3 },
      ),
    ).toThrow(ExperimentTransitionError);
    const analyzed = applyExperimentTransition(measuring, { target: "analyzed" }, { now: T3 });
    expect(() =>
      applyExperimentTransition(analyzed, { target: "measuring" }, { now: T3 }),
    ).toThrow(ExperimentTransitionError);
  });

  test("direct target=concluded is rejected outright (outcomes only via concludeExperiment)", () => {
    const error = capture(() =>
      applyExperimentTransition(runToAnalyzed(), { target: "concluded" } as never, {
        now: CONCLUDED_AT,
      }),
    );
    expect(error?.current).toBe("analyzed");
    expect(error?.target).toBe("concluded");
    expect(error?.message).toContain("concludeExperiment");
  });

  test("assigned without an assignment record is rejected by the schema", () => {
    expect(() =>
      applyExperimentTransition(
        experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
        { target: "assigned" } as never,
        { now: T2 },
      ),
    ).toThrow(ContractValidationError);
  });

  test("cancelled is reachable from every non-terminal status and is terminal", () => {
    for (const experiment of [
      experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
      applyExperimentTransition(
        experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
        { target: "assigned", assignment: ASSIGNMENT_RECORD },
        { now: T2 },
      ),
      applyExperimentTransition(
        applyExperimentTransition(
          experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
          { target: "assigned", assignment: ASSIGNMENT_RECORD },
          { now: T2 },
        ),
        { target: "measuring" },
        { now: T3 },
      ),
      runToAnalyzed(),
    ]) {
      const cancelled = applyExperimentTransition(experiment, { target: "cancelled" }, { now: T3 });
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.outcome).toBeNull(); // 取消不是结果：结果只有 concluded + evidence
    }

    const cancelled = applyExperimentTransition(
      experimentFromInput(baseInput(), { now: T1, id: "exp-1" }),
      { target: "cancelled" },
      { now: T3 },
    );
    expect(() =>
      applyExperimentTransition(cancelled, { target: "measuring" }, { now: T3 }),
    ).toThrow(ExperimentTransitionError);
    expect(() =>
      concludeExperiment(cancelled, concludeInput(), { now: CONCLUDED_AT }),
    ).toThrow(ExperimentTransitionError);
  });

  test("concluded is terminal (no further transitions, no cancel, no re-conclude)", () => {
    const concluded = concludeExperiment(runToAnalyzed(), concludeInput(), {
      now: CONCLUDED_AT,
    });
    for (const transition of [
      { target: "cancelled" },
      { target: "measuring" },
      { target: "assigned", assignment: ASSIGNMENT_RECORD },
    ] as const) {
      expect(() =>
        applyExperimentTransition(concluded, transition as never, { now: CONCLUDED_AT }),
      ).toThrow(ExperimentTransitionError);
    }
    expect(() =>
      concludeExperiment(concluded, concludeInput(), { now: CONCLUDED_AT }),
    ).toThrow(ExperimentTransitionError);
  });

  test("unknown status has no outgoing edges (fail-closed, never guessed)", () => {
    const unknown = handBuiltExperiment({ status: "unknown" });
    expect(() =>
      applyExperimentTransition(unknown, { target: "cancelled" }, { now: T3 }),
    ).toThrow(ExperimentTransitionError);
    expect(LEGAL_EXPERIMENT_TRANSITIONS.unknown).toEqual([]);
    expect(isLegalExperimentTransition("unknown", "cancelled")).toBe(false);
  });

  test("hand-built corrupted records are still schema-gated at every transition", () => {
    expect(() =>
      applyExperimentTransition(
        handBuiltExperiment({ status: "measuring", assignment: null }),
        { target: "analyzed" },
        { now: T3 },
      ),
    ).not.toThrow(); // measuring 无 assignment 是 schema 合法状态（assignment 可空）
    expect(() =>
      concludeExperiment(
        handBuiltExperiment({ status: "analyzed", statement: "" }),
        concludeInput(),
        { now: CONCLUDED_AT },
      ),
    ).toThrow(ContractValidationError);
  });
});
