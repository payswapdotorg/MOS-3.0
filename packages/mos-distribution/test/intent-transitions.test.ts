import { describe, expect, test } from "vitest";
import type { DistributionIntent } from "@mos/contracts";
import { InvariantViolation } from "@mos/contracts";
import {
  applyIntentTransition,
  bindPreview,
  intentFromInput,
  isLegalIntentTransition,
  LEGAL_INTENT_TRANSITIONS,
  recordExecution,
} from "../src/index.js";
import {
  ApprovalRequiredError,
  ContractValidationError,
  IntentTransitionError,
  IntentValidationError,
  PreviewRequiredError,
} from "../src/index.js";
import {
  baseInput,
  baseIntent,
  handBuiltIntent,
  PREVIEW_HASH,
  PREVIEW_REF,
  T1,
  T2,
  T3,
} from "./fixtures.js";

/**
 * DistributionIntent 状态机矩阵（纯 domain，零 I/O）：
 * 合法链路 happy path、预览/审批门禁（不变量 §22 具名错误）、跳态/回退/终态拒绝、
 * 证据引用 append-only 与防御性守卫。
 */

function previewBinding() {
  return { preview_ref: PREVIEW_REF, preview_hash: PREVIEW_HASH };
}

/** 完整合法链：intent → previewed → pending_approval → approved → executing。 */
function runToExecuting(id = "intent-1"): DistributionIntent {
  const intent = intentFromInput(baseInput(), { now: T1, id });
  const previewed = bindPreview(intent, previewBinding(), { now: T2 });
  const pending = applyIntentTransition(previewed, "pending_approval", { now: T2 });
  const approved = applyIntentTransition(pending, "approved", { now: T2 });
  return applyIntentTransition(approved, "executing", { now: T3 });
}

/** 捕获 IntentTransitionError 的具名 current/target（未抛错则返回 undefined）。 */
function capture(
  run: () => unknown,
): InstanceType<typeof IntentTransitionError> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof IntentTransitionError) return error;
    throw error;
  }
  return undefined;
}

describe("intentFromInput (creation is always preview-free and unapproved)", () => {
  test("forces status=intent, unbound preview, approval_state=pending, empty execution_records", () => {
    const intent = intentFromInput(
      baseInput({ operation: "delete", idempotency_key: "idem-1" }),
      { now: T1, id: "intent-new" },
    );
    expect(intent.status).toBe("intent");
    expect(intent.preview_ref).toBeNull();
    expect(intent.preview_hash).toBeNull();
    expect(intent.approval_state).toBe("pending");
    expect(intent.execution_records).toEqual([]);
    expect(intent.operation).toBe("delete");
    expect(intent.idempotency_key).toBe("idem-1");
    expect(intent.created_at).toBe(T1);
    expect(intent.updated_at).toBe(T1);
  });

  test("copies artifact/target verbatim; absent optionals stay null", () => {
    const intent = intentFromInput(
      baseInput({
        artifact_version: null,
        idempotency_key: null,
        target: { channel: "x", note: "  keep  spaces  " },
      }),
      { now: T1, id: "intent-min" },
    );
    expect(intent.artifact_version).toBeNull();
    expect(intent.idempotency_key).toBeNull();
    expect(intent.target).toEqual({ channel: "x", note: "  keep  spaces  " });
  });

  test("schema-invalid input fails closed with ContractValidationError", () => {
    expect(() =>
      intentFromInput(baseInput({ operation: "destroy" as never }), {
        now: T1,
        id: "intent-bad",
      }),
    ).toThrow(ContractValidationError);
    expect(() =>
      intentFromInput(baseInput({ artifact_ref: "" }), { now: T1, id: "intent-bad" }),
    ).toThrow(ContractValidationError);
  });
});

describe("happy path intent → previewed → pending_approval → approved → executing → succeeded", () => {
  test("each transition lands on the named status with coherent approval_state", () => {
    const intent = intentFromInput(baseInput(), { now: T1, id: "intent-1" });

    const previewed = bindPreview(intent, previewBinding(), { now: T2 });
    expect(previewed.status).toBe("previewed");
    expect(previewed.preview_ref).toBe(PREVIEW_REF);
    expect(previewed.preview_hash).toBe(PREVIEW_HASH);
    expect(previewed.updated_at).toBe(T2);
    expect(intent.status).toBe("intent"); // 纯函数：原记录不被变异
    expect(intent.preview_ref).toBeNull();

    const pending = applyIntentTransition(previewed, "pending_approval", { now: T2 });
    expect(pending.status).toBe("pending_approval");
    expect(pending.approval_state).toBe("pending");

    const approved = applyIntentTransition(pending, "approved", { now: T3 });
    expect(approved.status).toBe("approved");
    expect(approved.approval_state).toBe("approved");

    const executing = applyIntentTransition(approved, "executing", { now: T3 });
    expect(executing.status).toBe("executing");
    expect(executing.approval_state).toBe("approved");

    const succeeded = applyIntentTransition(executing, "succeeded", { now: T3 });
    expect(succeeded.status).toBe("succeeded");

    // executing 的另一个合法出口是 failed。
    const failed = applyIntentTransition(executing, "failed", { now: T3 });
    expect(failed.status).toBe("failed");
  });

  test("the full chain yields a succeeded intent with bound preview and approval", () => {
    const succeeded = applyIntentTransition(runToExecuting(), "succeeded", { now: T3 });
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.preview_ref).toBe(PREVIEW_REF);
    expect(succeeded.approval_state).toBe("approved");
  });
});

describe("preview binding gate (invariants §22, named PreviewRequiredError)", () => {
  test("bindPreview is the canonical intent→previewed path", () => {
    const previewed = bindPreview(baseIntent(), previewBinding(), { now: T2 });
    expect(previewed.status).toBe("previewed");
  });

  test("bindPreview rejects rebinding after previewed (preview binding is immutable)", () => {
    const previewed = bindPreview(baseIntent(), previewBinding(), { now: T2 });
    expect(() => bindPreview(previewed, previewBinding(), { now: T3 })).toThrow(
      IntentTransitionError,
    );
  });

  test("direct intent→previewed transition without a bound preview fails closed (PreviewRequiredError)", () => {
    expect(() =>
      applyIntentTransition(baseIntent(), "previewed", { now: T2 }),
    ).toThrow(PreviewRequiredError);
  });

  test("direct intent→previewed with a bound preview succeeds (hand-built record)", () => {
    const bound = handBuiltIntent({
      preview_ref: PREVIEW_REF,
      preview_hash: PREVIEW_HASH,
    });
    const previewed = applyIntentTransition(bound, "previewed", { now: T2 });
    expect(previewed.status).toBe("previewed");
  });

  test("approved→executing without a bound preview fails closed (PreviewRequiredError)", () => {
    const unbound = handBuiltIntent({
      status: "approved",
      approval_state: "approved",
      preview_ref: null,
      preview_hash: null,
    });
    expect(() => applyIntentTransition(unbound, "executing", { now: T3 })).toThrow(
      PreviewRequiredError,
    );
  });

  test("approved→executing with a bound preview but approval_state=pending fails closed (ApprovalRequiredError)", () => {
    const unapproved = handBuiltIntent({
      status: "approved",
      approval_state: "pending",
      preview_ref: PREVIEW_REF,
      preview_hash: PREVIEW_HASH,
    });
    expect(() =>
      applyIntentTransition(unapproved, "executing", { now: T3 }),
    ).toThrow(ApprovalRequiredError);
  });
});

describe("illegal transitions (skip / backtrack / terminal, named current+target)", () => {
  test("skipping states is rejected with named current/target", () => {
    const intent = baseIntent();
    const error = capture(() =>
      applyIntentTransition(intent, "pending_approval", { now: T2 }),
    );
    expect(error).toBeInstanceOf(IntentTransitionError);
    expect(error?.current).toBe("intent");
    expect(error?.target).toBe("pending_approval");

    const previewed = bindPreview(intent, previewBinding(), { now: T2 });
    const skip2 = capture(() =>
      applyIntentTransition(previewed, "approved", { now: T2 }),
    );
    expect(skip2?.current).toBe("previewed");
    expect(skip2?.target).toBe("approved");
  });

  test("intent→executing and intent→succeeded are rejected outright", () => {
    const intent = baseIntent();
    expect(() => applyIntentTransition(intent, "executing", { now: T2 })).toThrow(
      IntentTransitionError,
    );
    expect(() => applyIntentTransition(intent, "succeeded", { now: T2 })).toThrow(
      IntentTransitionError,
    );
  });

  test("backtracking is rejected (previewed→intent, executing→approved)", () => {
    const previewed = bindPreview(baseIntent(), previewBinding(), { now: T2 });
    expect(() => applyIntentTransition(previewed, "intent", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    const executing = runToExecuting();
    expect(() => applyIntentTransition(executing, "approved", { now: T3 })).toThrow(
      IntentTransitionError,
    );
  });

  test("succeeded and failed are terminal (no outgoing edges)", () => {
    const succeeded = applyIntentTransition(runToExecuting(), "succeeded", { now: T3 });
    for (const target of ["executing", "failed", "intent"] as const) {
      expect(() => applyIntentTransition(succeeded, target, { now: T3 })).toThrow(
        IntentTransitionError,
      );
    }
    const failed = applyIntentTransition(runToExecuting(), "failed", { now: T3 });
    expect(() => applyIntentTransition(failed, "succeeded", { now: T3 })).toThrow(
      IntentTransitionError,
    );
  });

  test("rejected intents cannot execute (rejection sets approval_state and is terminal)", () => {
    const previewed = bindPreview(baseIntent(), previewBinding(), { now: T2 });
    const pending = applyIntentTransition(previewed, "pending_approval", { now: T2 });
    const rejected = applyIntentTransition(pending, "rejected", { now: T3 });
    expect(rejected.status).toBe("rejected");
    expect(rejected.approval_state).toBe("rejected");

    const error = capture(() =>
      applyIntentTransition(rejected, "executing", { now: T3 }),
    );
    expect(error?.current).toBe("rejected");
    expect(error?.target).toBe("executing");
  });

  test("unknown status has no outgoing edges (fail-closed, never guessed)", () => {
    const unknown = handBuiltIntent({ status: "unknown" });
    expect(() => applyIntentTransition(unknown, "executing", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    expect(LEGAL_INTENT_TRANSITIONS.unknown).toEqual([]);
    expect(isLegalIntentTransition("unknown", "executing")).toBe(false);
  });
});

describe("recordExecution (append-only evidence refs, provider I/O lives elsewhere)", () => {
  test("appends evidence refs in order without mutating the input record", () => {
    const executing = runToExecuting();
    const withOne = recordExecution(executing, "evidence:linkedin:1", { now: T3 });
    expect(withOne.execution_records).toEqual(["evidence:linkedin:1"]);
    expect(executing.execution_records).toEqual([]); // append-only：原记录不变异

    const succeeded = applyIntentTransition(withOne, "succeeded", { now: T3 });
    const withTwo = recordExecution(succeeded, "evidence:linkedin:webhook", {
      now: T3,
    });
    expect(withTwo.execution_records).toEqual([
      "evidence:linkedin:1",
      "evidence:linkedin:webhook",
    ]);
  });

  test("empty evidence ref fails closed (IntentValidationError)", () => {
    expect(() => recordExecution(runToExecuting(), "", { now: T3 })).toThrow(
      IntentValidationError,
    );
  });

  test("evidence refs are rejected before execution starts and after rejection", () => {
    const intent = baseIntent();
    expect(() => recordExecution(intent, "evidence:x", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    const previewed = bindPreview(intent, previewBinding(), { now: T2 });
    expect(() => recordExecution(previewed, "evidence:x", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    const pending = applyIntentTransition(previewed, "pending_approval", { now: T2 });
    expect(() => recordExecution(pending, "evidence:x", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    const approved = applyIntentTransition(pending, "approved", { now: T2 });
    expect(() => recordExecution(approved, "evidence:x", { now: T3 })).toThrow(
      IntentTransitionError,
    );
    const rejected = applyIntentTransition(pending, "rejected", { now: T2 });
    expect(() => recordExecution(rejected, "evidence:x", { now: T3 })).toThrow(
      IntentTransitionError,
    );
  });

  test("execution evidence on a hand-built executing record without approved preview fails closed (invariant §22)", () => {
    const corrupt = handBuiltIntent({
      status: "executing",
      approval_state: "pending",
      preview_ref: null,
      preview_hash: null,
    });
    expect(() => recordExecution(corrupt, "evidence:x", { now: T3 })).toThrow(
      InvariantViolation,
    );
  });
});
