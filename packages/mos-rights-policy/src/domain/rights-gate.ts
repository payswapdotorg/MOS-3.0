import { assertRightsClearedForUse, InvariantViolation } from "@mos/contracts";
import type { RightsRecord } from "@mos/contracts";

/**
 * 权利门禁纯函数（零 I/O、零 Date/random；fail-closed，永不猜测）。
 *
 * 语义与 @mos/contracts 的 assertRightsClearedForUse（不变量 §18
 * "rights-gate-never-guesses"）完全同源，但返回判定对象而非抛错：
 * - 覆盖判定：subject_artifact_ref 精确匹配 artifactRef，或 null 通配；
 *   kind 为 "unknown" 的记录不覆盖任何 artifact（与 assert 的覆盖过滤器一致）；
 * - 只有覆盖该 artifact 且 granted + decided_at 非空 + 未过期的记录才 cleared；
 * - 拒绝原因具名且确定（优先级：denied > pending > expired > 残余）：
 *   - no_covering_record：无覆盖记录（缺记录 = 拒绝）；
 *   - explicit_denial：存在 denied 决定；
 *   - decision_pending：存在 pending 决定（无有效 granted）；
 *   - expired：存在过期（存储 decision=expired，或 granted 但 expires_at <= now）；
 *   - no_valid_decision：残余不可分类（decision=unknown 或 granted 但 decided_at 为空）。
 *
 * 过期边界（与 assertRightsClearedForUse 的 `record.expires_at > now` 严格一致）：
 * expires_at === now 即已过期——只有严格大于 now 才有效（== 不通过，绝不放行）。
 *
 * 一致性锚定：每个判定都与 assertRightsClearedForUse 复核一次（cleared ⇔ 守卫不抛错），
 * 不一致 → InvariantViolation（fail-closed，本门禁绝不允许越过共享契约）。
 */

/** 拒绝原因词表（具名、确定；永不出现未命名的拒绝）。 */
export const RIGHTS_GATE_DENY_REASONS = [
  "no_covering_record",
  "explicit_denial",
  "decision_pending",
  "expired",
  "no_valid_decision",
] as const;
export type RightsGateDenyReason = (typeof RIGHTS_GATE_DENY_REASONS)[number];

/** 判定原因：cleared 时为 "granted"，否则为具名拒绝原因。 */
export type RightsGateReason = "granted" | RightsGateDenyReason;

/** 权利门禁判定：cleared 只有在存在有效 granted 决定时为 true；reason 永远具名。 */
export interface RightsGateVerdict {
  readonly cleared: boolean;
  readonly reason: RightsGateReason;
}

/** 门禁输入（与 assertRightsClearedForUse 同形）。 */
export interface RightsGateInput {
  readonly artifactRef: string;
  readonly records: ReadonlyArray<RightsRecord>;
  readonly now: string;
}

export function evaluateRightsGate(input: RightsGateInput): RightsGateVerdict {
  const { artifactRef, records, now } = input;

  // 覆盖过滤器与 assertRightsClearedForUse 一致：
  // subject_artifact_ref 精确匹配或 null 通配；kind unknown 不覆盖。
  const covering = records.filter(
    (record) =>
      (record.subject_artifact_ref === artifactRef || record.subject_artifact_ref === null) &&
      record.kind !== "unknown",
  );

  let verdict: RightsGateVerdict;
  if (covering.length === 0) {
    verdict = { cleared: false, reason: "no_covering_record" };
  } else if (covering.some((record) => record.decision === "denied")) {
    verdict = { cleared: false, reason: "explicit_denial" };
  } else if (
    covering.some(
      (record) =>
        record.decision === "granted" &&
        record.decided_at !== null &&
        (record.expires_at === null || record.expires_at > now),
    )
  ) {
    verdict = { cleared: true, reason: "granted" };
  } else if (covering.some((record) => record.decision === "pending")) {
    verdict = { cleared: false, reason: "decision_pending" };
  } else if (
    covering.some(
      (record) =>
        record.decision === "expired" ||
        (record.decision === "granted" &&
          record.expires_at !== null &&
          record.expires_at <= now),
    )
  ) {
    // 过期边界：expires_at === now 落在此分支（<= now 即过期；> now 才有效）。
    verdict = { cleared: false, reason: "expired" };
  } else {
    // 残余（decision=unknown，或 granted 但 decided_at 为 null）：永不猜测 → 拒绝。
    verdict = { cleared: false, reason: "no_valid_decision" };
  }

  return anchorWithSharedGuard(input, verdict);
}

/**
 * 一致性锚定：cleared ⇔ assertRightsClearedForUse 不抛错。
 * 守卫只抛 InvariantViolation（rights-gate-fail-closed）——与本门禁的
 * fail-closed 方向一致；任何方向的不一致都是缺陷 → InvariantViolation。
 */
function anchorWithSharedGuard(
  input: RightsGateInput,
  verdict: RightsGateVerdict,
): RightsGateVerdict {
  let sharedGuardDenies = false;
  try {
    assertRightsClearedForUse(input);
  } catch {
    sharedGuardDenies = true;
  }
  if (verdict.cleared === sharedGuardDenies) {
    throw new InvariantViolation(
      "rights-gate-consistency",
      `门禁判定 (cleared=${verdict.cleared}, reason=${verdict.reason}) 与 assertRightsClearedForUse 不一致`,
    );
  }
  return verdict;
}
