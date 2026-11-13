import { describe, expect, test } from "vitest";
import { assertRightsClearedForUse, rightsRecordSchema } from "@mos/contracts";
import type { RightsRecord } from "@mos/contracts";
import { evaluateRightsGate } from "../src/index.js";

/**
 * 权利门禁矩阵（domain/rights-gate.ts，纯函数）：
 * 覆盖判定（精确/通配）、全部拒绝路径（具名原因）、过期边界
 * （expires_at == now 即过期——与 assertRightsClearedForUse 的 `> now` 语义一致）
 * 以及与共享守卫的一致性 oracle（cleared ⇔ 守卫不抛错）。
 */

const NOW = "2026-11-13T12:00:00Z";
const LATER = "2026-11-13T18:00:00Z";
const ARTIFACT = "artifact:art-1:1";

/** 完整权利记录（与共享 rightsRecordSchema 同形）。 */
function record(overrides: Partial<RightsRecord> = {}): RightsRecord {
  return rightsRecordSchema.parse({
    id: "rights-1",
    tenant_id: "tenant-acme",
    kind: "source_license",
    subject_ref: "asset-brief",
    subject_artifact_ref: ARTIFACT,
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

function gate(
  records: readonly RightsRecord[],
  artifactRef: string = ARTIFACT,
  now: string = NOW,
) {
  return evaluateRightsGate({ artifactRef, records, now });
}

describe("evaluateRightsGate (cleared only with a valid granted covering record)", () => {
  test("granted + decided + no expiry clears (matrix a)", () => {
    const verdict = gate([record({ expires_at: null })]);
    expect(verdict).toEqual({ cleared: true, reason: "granted" });
  });

  test("granted + decided + unexpired (expires_at > now) clears", () => {
    expect(gate([record()])).toEqual({ cleared: true, reason: "granted" });
    expect(gate([record()], ARTIFACT, "2026-11-13T12:00:01Z")).toEqual({
      cleared: true,
      reason: "granted",
    });
  });

  test("wildcard coverage: null subject_artifact_ref covers any artifact (matrix b)", () => {
    expect(gate([record({ subject_artifact_ref: null })], "artifact:any-other:7")).toEqual({
      cleared: true,
      reason: "granted",
    });
  });

  test("exact coverage only: a record bound to another artifact does not cover", () => {
    expect(gate([record({ subject_artifact_ref: "artifact:art-2:1" })])).toEqual({
      cleared: false,
      reason: "no_covering_record",
    });
  });

  test("wildcard and exact records combine: either may clear or deny", () => {
    const wildcardDenied = record({ id: "r-w", subject_artifact_ref: null, decision: "denied" });
    const exactGranted = record({ id: "r-e" });
    expect(gate([wildcardDenied, exactGranted])).toEqual({
      cleared: false,
      reason: "explicit_denial",
    });
  });
});

describe("evaluateRightsGate (deny paths, named reasons, never guesses)", () => {
  test("missing records deny with no_covering_record (matrix c)", () => {
    expect(gate([])).toEqual({ cleared: false, reason: "no_covering_record" });
  });

  test("kind unknown records never cover (mirrors the assert covering filter)", () => {
    expect(gate([record({ kind: "unknown" as RightsRecord["kind"] })])).toEqual({
      cleared: false,
      reason: "no_covering_record",
    });
  });

  test("denied record denies with explicit_denial — even beside a valid grant (matrix c)", () => {
    expect(
      gate([record({ id: "r-grant" }), record({ id: "r-deny", decision: "denied" })]),
    ).toEqual({ cleared: false, reason: "explicit_denial" });
  });

  test("pending record denies with decision_pending (no valid grant)", () => {
    expect(gate([record({ decision: "pending", decided_at: null })])).toEqual({
      cleared: false,
      reason: "decision_pending",
    });
  });

  test("stored expired decision denies with expired (matrix c)", () => {
    expect(gate([record({ decision: "expired", expires_at: null })])).toEqual({
      cleared: false,
      reason: "expired",
    });
  });

  test("time-expired grant (expires_at < now) denies with expired (matrix c)", () => {
    expect(gate([record()], ARTIFACT, LATER)).toEqual({ cleared: false, reason: "expired" });
  });

  test("expiry boundary: expires_at == now is EXPIRED (strict `expires_at > now` semantics)", () => {
    // assertRightsClearedForUse 的有效性判定是 `record.expires_at > now`：
    // expires_at === now 不满足严格大于 → 已过期（== 不放行，绝不猜测）。
    const atBoundary = gate([record({ expires_at: NOW })], ARTIFACT, NOW);
    expect(atBoundary).toEqual({ cleared: false, reason: "expired" });
    // 一秒之前仍有效（严格大于成立）。
    const justBefore = gate(
      [record({ expires_at: "2026-11-13T12:00:01Z" })],
      ARTIFACT,
      NOW,
    );
    expect(justBefore).toEqual({ cleared: true, reason: "granted" });
  });

  test("granted without decided_at denies with no_valid_decision (undated grant is not a decided grant)", () => {
    expect(gate([record({ decided_at: null })])).toEqual({
      cleared: false,
      reason: "no_valid_decision",
    });
  });

  test("decision unknown denies with no_valid_decision (never guesses)", () => {
    expect(gate([record({ decision: "unknown" as RightsRecord["decision"] })])).toEqual({
      cleared: false,
      reason: "no_valid_decision",
    });
  });

  test("deny reason precedence: denial > pending > expired > residual", () => {
    expect(
      gate([
        record({ id: "r-p", decision: "pending", decided_at: null }),
        record({ id: "r-d", decision: "denied" }),
      ]),
    ).toEqual({ cleared: false, reason: "explicit_denial" });
    expect(
      gate([
        record({ id: "r-p", decision: "pending", decided_at: null }),
        record({ id: "r-x", decision: "expired" }),
      ]),
    ).toEqual({ cleared: false, reason: "decision_pending" });
    expect(
      gate([
        record({ id: "r-x", decision: "expired" }),
        record({ id: "r-u", decision: "unknown" as RightsRecord["decision"] }),
      ]),
    ).toEqual({ cleared: false, reason: "expired" });
  });
});

describe("evaluateRightsGate (consistency oracle against assertRightsClearedForUse)", () => {
  test("cleared verdicts and deny verdicts always agree with the shared guard", () => {
    const scenarios: ReadonlyArray<{
      readonly name: string;
      readonly records: readonly RightsRecord[];
      readonly artifactRef: string;
      readonly now: string;
    }> = [
      { name: "granted-unexpired", records: [record()], artifactRef: ARTIFACT, now: NOW },
      {
        name: "wildcard-granted",
        records: [record({ subject_artifact_ref: null })],
        artifactRef: "artifact:any:1",
        now: NOW,
      },
      { name: "missing", records: [], artifactRef: ARTIFACT, now: NOW },
      {
        name: "denied",
        records: [record({ decision: "denied" })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "pending",
        records: [record({ decision: "pending", decided_at: null })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "stored-expired",
        records: [record({ decision: "expired", expires_at: null })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "time-expired",
        records: [record()],
        artifactRef: ARTIFACT,
        now: LATER,
      },
      {
        name: "boundary-eq-now",
        records: [record({ expires_at: NOW })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "undated-grant",
        records: [record({ decided_at: null })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "kind-unknown",
        records: [record({ kind: "unknown" as RightsRecord["kind"] })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
      {
        name: "other-artifact-only",
        records: [record({ subject_artifact_ref: "artifact:art-9:1" })],
        artifactRef: ARTIFACT,
        now: NOW,
      },
    ];

    for (const scenario of scenarios) {
      const verdict = evaluateRightsGate({
        artifactRef: scenario.artifactRef,
        records: scenario.records,
        now: scenario.now,
      });
      let sharedGuardDenies = false;
      try {
        assertRightsClearedForUse({
          artifactRef: scenario.artifactRef,
          records: scenario.records,
          now: scenario.now,
        });
      } catch {
        sharedGuardDenies = true;
      }
      // 门禁判定必须与共享守卫一致（不一致时 evaluateRightsGate 自身已 fail-closed 抛
      // InvariantViolation，此断言把一致性固化为契约测试）。
      expect(verdict.cleared, scenario.name).toBe(!sharedGuardDenies);
    }
  });
});
