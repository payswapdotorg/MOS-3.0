import {
  assertHypothesisCarriesNoOutcome,
  hypothesisSchema,
  InvariantViolation,
  parseOrFail,
} from "@mos/contracts";
import type { Experiment, Hypothesis, HypothesisStatus } from "@mos/contracts";
import {
  EXPERIMENT_STATUS_ANALYZED,
  EXPERIMENT_STATUS_ASSIGNED,
  EXPERIMENT_STATUS_CONCLUDED,
  EXPERIMENT_STATUS_MEASURING,
  HypothesisAdoptionError,
} from "../contract/experiment.js";
import type { AdoptedHypothesis } from "../contract/adoption.js";
import type { AdoptionDeps } from "../contract/adoption.js";

/**
 * 假设采纳纯函数（决策锁 #18：实验采纳假设的写入权归 Experiment authority）。
 *
 * 判定矩阵（全部 fail-closed，具名 reason）：
 * 1. 输入一致性：假设与实验必须同租户（不一致 → InvariantViolation，与 lab
 *    program-discovery 的输入一致性守卫同模式）；
 * 2. 实验状态 ∈ {assigned, measuring, analyzed, concluded}（defined = 尚未开始实验、
 *    unknown/cancelled = 不可采纳 → hypothesis 侧 mission_mismatch 之外最先判定的
 *    experiment_status_invalid）；
 * 3. hypothesis.mission_id === experiment.mission_id（实验无 mission 或指向不同
 *    mission → mission_mismatch——假设绝不被挂到无关实验上）；
 * 4. hypothesis.status ∈ {proposed, superseded}（已采纳/withdrawn/unknown →
 *    hypothesis_status_invalid）。
 *
 * 产物：status=adopted_by_experiment、experiment_ref=experiment.id、updated_at=注入
 * 时间；其余字段逐字保留（statement/rationale/evidence_refs/proposed_route_ids/
 * created_at 不改写）；经 hypothesisSchema + assertHypothesisCarriesNoOutcome
 * （契约不变量 §15）双向守卫。
 */

/** 允许采纳假设的实验状态：实验开始后（assigned 及之后）才可采纳。 */
export const ADOPTION_ELIGIBLE_EXPERIMENT_STATUSES = [
  EXPERIMENT_STATUS_ASSIGNED,
  EXPERIMENT_STATUS_MEASURING,
  EXPERIMENT_STATUS_ANALYZED,
  EXPERIMENT_STATUS_CONCLUDED,
] as const;
export type AdoptionEligibleExperimentStatus =
  (typeof ADOPTION_ELIGIBLE_EXPERIMENT_STATUSES)[number];

/** 可被采纳的假设状态：proposed / superseded（lab 生命周期词表内可继续演化的状态）。 */
export const ADOPTABLE_HYPOTHESIS_STATUSES = ["proposed", "superseded"] as const;
export type AdoptableHypothesisStatus = (typeof ADOPTABLE_HYPOTHESIS_STATUSES)[number];

/** 采纳产物落 @mos/lab saveHypothesis 的纯构造（零 I/O；写经 HypothesisUpdatePort）。 */
export function buildAdoption(
  experiment: Experiment,
  hypothesis: Hypothesis,
  deps: AdoptionDeps,
): AdoptedHypothesis {
  if (hypothesis.tenant_id !== experiment.tenant_id) {
    throw new InvariantViolation(
      "experiment-adoption-tenant-scope",
      `假设 ${hypothesis.id}（tenant ${hypothesis.tenant_id}）与实验 ${experiment.id}（tenant ${experiment.tenant_id}）不属于同一租户`,
    );
  }
  if (
    !(ADOPTION_ELIGIBLE_EXPERIMENT_STATUSES as readonly string[]).includes(experiment.status)
  ) {
    throw new HypothesisAdoptionError(
      "experiment_status_invalid",
      experiment.id,
      hypothesis.id,
      `实验状态 ${experiment.status} 不可采纳假设（须为 assigned/measuring/analyzed/concluded）`,
    );
  }
  if (hypothesis.mission_id !== experiment.mission_id) {
    throw new HypothesisAdoptionError(
      "mission_mismatch",
      experiment.id,
      hypothesis.id,
      `假设 mission ${hypothesis.mission_id} 与实验 mission ${String(experiment.mission_id)} 不一致`,
    );
  }
  if (
    !(ADOPTABLE_HYPOTHESIS_STATUSES as readonly HypothesisStatus[]).includes(hypothesis.status)
  ) {
    throw new HypothesisAdoptionError(
      "hypothesis_status_invalid",
      experiment.id,
      hypothesis.id,
      `假设状态 ${hypothesis.status} 不可采纳（已采纳/withdrawn/unknown 一律拒绝）`,
    );
  }

  const adopted: AdoptedHypothesis = {
    ...hypothesis,
    status: "adopted_by_experiment",
    experiment_ref: experiment.id,
    updated_at: deps.now,
  };
  // 契约不变量 §15 双向守卫：adopted_by_experiment 必须且只需携带 experiment_ref。
  parseOrFail("Hypothesis", hypothesisSchema, adopted);
  assertHypothesisCarriesNoOutcome(adopted);
  return adopted;
}
