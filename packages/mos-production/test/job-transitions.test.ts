import { describe, expect, test } from "vitest";
import type { ProductionJob } from "@mos/contracts";
import { InvariantViolation } from "@mos/contracts";
import { applyJobEvent, nextJobStatus } from "../src/index.js";
import type { ProductionJobEvent } from "../src/index.js";
import { JobTransitionError } from "../src/index.js";

/**
 * job 转移矩阵（纯函数）：合法/非法转移表、事件数据要求
 * （linked 必须携带外部 zcode_execution_ref + started_at——决策锁 #5）、
 * applyJobEvent 记录演化 + assertJobNeverExecutes 最终守卫。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const T4 = "2026-11-13T03:00:00Z";
const EXECUTION_REF = "zcode:wf:execution-1";

function job(status: ProductionJob["status"], overrides: Partial<ProductionJob> = {}): ProductionJob {
  return {
    id: "job-1",
    tenant_id: "tenant-acme",
    graph_id: "graph-1",
    graph_version: 2,
    status,
    zcode_execution_ref: null,
    started_at: null,
    completed_at: null,
    output_artifact_refs: [],
    failure: null,
    created_at: T1,
    updated_at: T1,
    ...overrides,
  };
}

/** 已 linked 的基准 job（携带外部执行引用——组合根供给的不透明引用）。 */
function linkedJob(overrides: Partial<ProductionJob> = {}): ProductionJob {
  return job("linked", {
    zcode_execution_ref: EXECUTION_REF,
    started_at: T2,
    updated_at: T2,
    ...overrides,
  });
}

describe("nextJobStatus (legal transitions)", () => {
  test("pending + linked -> linked", () => {
    expect(
      nextJobStatus("pending", {
        kind: "linked",
        zcode_execution_ref: EXECUTION_REF,
        started_at: T2,
      }),
    ).toBe("linked");
  });

  test("pending + cancelled -> cancelled (legal in the transition table)", () => {
    expect(nextJobStatus("pending", { kind: "cancelled" })).toBe("cancelled");
  });

  test("linked + cancelled -> cancelled", () => {
    expect(nextJobStatus("linked", { kind: "cancelled" })).toBe("cancelled");
  });

  test("linked + executing -> executing (external observation only)", () => {
    expect(nextJobStatus("linked", { kind: "executing" })).toBe("executing");
  });

  test("executing + succeeded -> succeeded", () => {
    expect(nextJobStatus("executing", { kind: "succeeded", completed_at: T3 })).toBe("succeeded");
  });

  test("executing + failed -> failed", () => {
    expect(nextJobStatus("executing", { kind: "failed", failure: "engine crashed" })).toBe("failed");
  });
});

describe("nextJobStatus (illegal transitions -> JobTransitionError)", () => {
  test("pending cannot succeed/fail/observe executing before being linked", () => {
    expect(() => nextJobStatus("pending", { kind: "succeeded", completed_at: T3 })).toThrow(
      JobTransitionError,
    );
    expect(() => nextJobStatus("pending", { kind: "failed", failure: "boom" })).toThrow(
      JobTransitionError,
    );
    expect(() => nextJobStatus("pending", { kind: "executing" })).toThrow(JobTransitionError);
  });

  test("linked cannot succeed/fail without observing executing first", () => {
    expect(() => nextJobStatus("linked", { kind: "succeeded", completed_at: T3 })).toThrow(
      JobTransitionError,
    );
    expect(() => nextJobStatus("linked", { kind: "failed", failure: "boom" })).toThrow(
      JobTransitionError,
    );
  });

  test("linked cannot be re-linked with another execution ref", () => {
    expect(() =>
      nextJobStatus("linked", {
        kind: "linked",
        zcode_execution_ref: "zcode:wf:execution-2",
        started_at: T3,
      }),
    ).toThrow(JobTransitionError);
  });

  test("executing cannot be cancelled / re-linked / re-observed", () => {
    expect(() => nextJobStatus("executing", { kind: "cancelled" })).toThrow(JobTransitionError);
    expect(() =>
      nextJobStatus("executing", {
        kind: "linked",
        zcode_execution_ref: EXECUTION_REF,
        started_at: T2,
      }),
    ).toThrow(JobTransitionError);
    expect(() => nextJobStatus("executing", { kind: "executing" })).toThrow(JobTransitionError);
  });

  test("terminal states (succeeded/failed/cancelled) accept no further events", () => {
    const terminal: ProductionJob["status"][] = ["succeeded", "failed", "cancelled"];
    for (const status of terminal) {
      expect(() =>
        nextJobStatus(status, { kind: "linked", zcode_execution_ref: EXECUTION_REF, started_at: T2 }),
      ).toThrow(JobTransitionError);
      expect(() => nextJobStatus(status, { kind: "succeeded", completed_at: T3 })).toThrow(
        JobTransitionError,
      );
      expect(() => nextJobStatus(status, { kind: "failed", failure: "boom" })).toThrow(
        JobTransitionError,
      );
      expect(() => nextJobStatus(status, { kind: "cancelled" })).toThrow(JobTransitionError);
      expect(() => nextJobStatus(status, { kind: "executing" })).toThrow(JobTransitionError);
    }
  });

  test("unknown status accepts no events (fail-closed)", () => {
    expect(() =>
      nextJobStatus("unknown", { kind: "linked", zcode_execution_ref: EXECUTION_REF, started_at: T2 }),
    ).toThrow(JobTransitionError);
    expect(() => nextJobStatus("unknown", { kind: "cancelled" })).toThrow(JobTransitionError);
  });

  test("the error is named with current status and event kind", () => {
    try {
      nextJobStatus("pending", { kind: "succeeded", completed_at: T3 });
      expect.unreachable("nextJobStatus must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(JobTransitionError);
      const transitionError = error as JobTransitionError;
      expect(transitionError.currentStatus).toBe("pending");
      expect(transitionError.eventKind).toBe("succeeded");
      expect(transitionError.message).toContain("pending + succeeded");
    }
  });
});

describe("nextJobStatus (event data requirements)", () => {
  test("linked requires an external zcode_execution_ref (decision lock #5)", () => {
    expect(() =>
      nextJobStatus("pending", { kind: "linked", zcode_execution_ref: "", started_at: T2 }),
    ).toThrow(/zcode_execution_ref/);
    expect(() =>
      nextJobStatus("pending", {
        kind: "linked",
        zcode_execution_ref: "   ",
        started_at: T2,
      }),
    ).toThrow(/zcode_execution_ref/);
  });

  test("linked requires started_at", () => {
    expect(() =>
      nextJobStatus("pending", {
        kind: "linked",
        zcode_execution_ref: EXECUTION_REF,
        started_at: "",
      }),
    ).toThrow(/started_at/);
  });

  test("succeeded requires completed_at", () => {
    expect(() =>
      nextJobStatus("executing", { kind: "succeeded", completed_at: "" }),
    ).toThrow(/completed_at/);
  });

  test("failed requires a failure note", () => {
    expect(() => nextJobStatus("executing", { kind: "failed", failure: "" })).toThrow(/failure/);
    expect(() => nextJobStatus("executing", { kind: "failed", failure: "  " })).toThrow(/failure/);
  });
});

describe("applyJobEvent (record evolution + no-second-executor guard)", () => {
  test("linked merges the external ref + started_at verbatim and advances updated_at", () => {
    const updated = applyJobEvent(
      job("pending"),
      { kind: "linked", zcode_execution_ref: EXECUTION_REF, started_at: T2 },
      T2,
    );
    expect(updated.status).toBe("linked");
    expect(updated.zcode_execution_ref).toBe(EXECUTION_REF);
    expect(updated.started_at).toBe(T2);
    expect(updated.updated_at).toBe(T2);
    expect(updated.created_at).toBe(T1);
  });

  test("executing is a pure external observation: no data fields change, only status + updated_at", () => {
    const updated = applyJobEvent(linkedJob(), { kind: "executing" }, T3);
    expect(updated.status).toBe("executing");
    expect(updated.zcode_execution_ref).toBe(EXECUTION_REF);
    expect(updated.started_at).toBe(T2);
    expect(updated.completed_at).toBeNull();
    expect(updated.failure).toBeNull();
    expect(updated.updated_at).toBe(T3);
  });

  test("full happy path: pending -> linked -> executing -> succeeded", () => {
    const linked = applyJobEvent(
      job("pending"),
      { kind: "linked", zcode_execution_ref: EXECUTION_REF, started_at: T2 },
      T2,
    );
    const executing = applyJobEvent(linked, { kind: "executing" }, T3);
    const succeeded = applyJobEvent(executing, { kind: "succeeded", completed_at: T4 }, T4);
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.completed_at).toBe(T4);
    expect(succeeded.zcode_execution_ref).toBe(EXECUTION_REF);
  });

  test("failed records the failure note verbatim", () => {
    const failed = applyJobEvent(
      job("executing", { zcode_execution_ref: EXECUTION_REF, started_at: T2 }),
      { kind: "failed", failure: "engine crashed" },
      T3,
    );
    expect(failed.status).toBe("failed");
    expect(failed.failure).toBe("engine crashed");
  });

  test("linked -> cancelled keeps the external ref (guard satisfied)", () => {
    const cancelled = applyJobEvent(linkedJob(), { kind: "cancelled" }, T3);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.zcode_execution_ref).toBe(EXECUTION_REF);
  });

  test("pending -> cancelled is rejected by the shared guard assertJobNeverExecutes (documented conflict)", () => {
    // W3-B 已知契约张力（显式上报 TL，绝不静默择一）：
    // 转移表按工作包把 pending→cancelled 判为合法，但共享守卫 assertJobNeverExecutes
    // 把 cancelled 视为“越过 linked”——无外部执行引用的 cancelled 记录被 fail-closed 拒绝。
    // 需 TL 裁决：守卫排除 cancelled，或转移表删除 pending→cancelled。
    expect(() => applyJobEvent(job("pending"), { kind: "cancelled" }, T3)).toThrow(
      InvariantViolation,
    );
  });

  test("illegal transition via applyJobEvent throws before any record change", () => {
    const pending = job("pending");
    expect(() =>
      applyJobEvent(pending, { kind: "succeeded", completed_at: T3 }, T3),
    ).toThrow(JobTransitionError);
    // 纯函数：原记录不变。
    expect(pending.status).toBe("pending");
  });

  test("events never add execution primitives: the record only carries an opaque external ref", () => {
    // 决策锁 #5：记录结构里没有任何执行原语字段——zcode_execution_ref 是唯一的外部引用。
    const updated = applyJobEvent(
      job("executing", { zcode_execution_ref: EXECUTION_REF, started_at: T2 }),
      { kind: "succeeded", completed_at: T3 },
      T3,
    );
    const recordKeys = Object.keys(updated).sort();
    expect(recordKeys).toEqual([
      "completed_at",
      "created_at",
      "failure",
      "graph_id",
      "graph_version",
      "id",
      "output_artifact_refs",
      "started_at",
      "status",
      "tenant_id",
      "updated_at",
      "zcode_execution_ref",
    ]);
  });

  test("event data requirements are enforced through applyJobEvent as well", () => {
    expect(() =>
      applyJobEvent(job("pending"), {
        kind: "linked",
        zcode_execution_ref: "",
        started_at: T2,
      } as ProductionJobEvent, T2),
    ).toThrow(JobTransitionError);
  });
});
