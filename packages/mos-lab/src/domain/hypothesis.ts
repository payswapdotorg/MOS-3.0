import {
  assertHypothesisCarriesNoOutcome,
  hypothesisSchema,
  InvariantViolation,
  parseOrFail,
} from "@mos/contracts";
import type { Hypothesis } from "@mos/contracts";
import { hypothesisProposalSchema } from "../contract/hypothesis.js";
import type { HypothesisProposal } from "../contract/hypothesis.js";
import type { HypothesisProposalDeps } from "../contract.js";
import {
  HYPOTHESIS_STATUS_PROPOSED,
  LAB_WRITABLE_HYPOTHESIS_STATUSES,
} from "../contract/lab-vocabulary.js";

/**
 * 假设提案 → Hypothesis（纯函数，零推断、零 I/O、零 Date/random）。
 *
 * 决策锁 #18：Lab 提出假设；实验定义/证据/结果归 Experiment authority（W3）。
 * - 提案形状（HypothesisProposal）本身不含 status / experiment_ref——结果语义不可表达；
 * - 创建恒为 status="proposed"、experiment_ref=null（强制值，不是校验值）；
 * - 产物经 hypothesisSchema parseOrFail + assertHypothesisCarriesNoOutcome 双向守卫。
 */
export function hypothesisFromProposal(
  proposal: HypothesisProposal,
  deps: HypothesisProposalDeps,
): Hypothesis {
  const normalized = parseOrFail(
    "HypothesisProposal",
    hypothesisProposalSchema,
    proposal,
  ) as HypothesisProposal;

  const hypothesis: Hypothesis = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    mission_id: normalized.mission_id,
    statement: normalized.statement,
    rationale: normalized.rationale,
    evidence_refs: [...normalized.evidence_refs],
    proposed_route_ids: [...normalized.proposed_route_ids],
    status: HYPOTHESIS_STATUS_PROPOSED,
    experiment_ref: null,
    created_at: deps.now,
    updated_at: deps.now,
  };

  const validated = parseOrFail("Hypothesis", hypothesisSchema, hypothesis) as Hypothesis;
  assertHypothesisCarriesNoOutcome(validated);
  return validated;
}

/**
 * Lab 写边界守卫（决策锁 #18）：本模块的任何写路径都不得携带实验结果。
 * - 契约不变量 §15（assertHypothesisCarriesNoOutcome）先行；
 * - 再加 lab 权威规则：experiment_ref 任何非 null 值、status=adopted_by_experiment
 *   一律 fail-closed——实验采纳的写入权归 Experiment authority（W3），
 *   即使 (adopted_by_experiment + experiment_ref) 是契约层的合法组合，
 *   lab 写边界也拒绝产生它。
 */
export function assertLabHypothesisCarriesNoOutcome(hypothesis: Hypothesis): void {
  assertHypothesisCarriesNoOutcome(hypothesis);
  if (hypothesis.experiment_ref !== null) {
    throw new InvariantViolation(
      "lab-hypothesis-no-outcome",
      `Lab 写边界永不携带 experiment_ref（决策锁 #18，写入权归 Experiment authority）: ${hypothesis.id}`,
    );
  }
  if (!(LAB_WRITABLE_HYPOTHESIS_STATUSES as readonly string[]).includes(hypothesis.status)) {
    throw new InvariantViolation(
      "lab-hypothesis-no-outcome",
      `状态 ${hypothesis.status} 表达实验采纳，Lab 写边界不得产生（决策锁 #18）: ${hypothesis.id}`,
    );
  }
}
