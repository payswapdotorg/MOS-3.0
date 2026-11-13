import type { Experiment, Hypothesis } from "@mos/contracts";
import { experimentFromInput } from "../src/index.js";
import type { ExperimentInput } from "../src/index.js";

/**
 * 测试夹具：mos-experiments 最小合法事实集（本包不得 import @mos/lab 等模块——
 * hypothesis 记录按 @mos/contracts 的 hypothesisSchema 形状逐字构造，与组合根
 * 从 lab 读出的当前记录同形）。
 */

export const T1 = "2026-11-13T00:00:00Z";
export const T2 = "2026-11-13T01:00:00Z";
export const T3 = "2026-11-13T02:00:00Z";
export const TENANT = "tenant-acme";
export const OTHER_TENANT = "tenant-globex";
export const MISSION_ID = "mos-mission-fixture";
export const OTHER_MISSION_ID = "mos-mission-other";
export const HYPOTHESIS_ID = "hyp-1";
export const OTHER_HYPOTHESIS_ID = "hyp-2";
export const STORE_FILE = "mos-experiments.json";

export const EVIDENCE_REF = "evidence:experiment-observation:pricing-page-ab:1";
export const EVIDENCE_REF_2 = "evidence:experiment-observation:pricing-page-ab:2";
export const CONCLUDED_AT = "2026-11-20T00:00:00Z";

export const ASSIGNMENT_RECORD = {
  variant_split: "50/50",
  audience: "linkedin-followers",
  duration_days: 14,
};

export function baseInput(
  overrides: Partial<ExperimentInput> = {},
): ExperimentInput {
  return {
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    hypothesis_id: null,
    statement: "Pricing page A increases qualified inbound leads vs page B.",
    design: { method: "ab_test", primary_metric: "qualified_inbound_leads" },
    ...overrides,
  };
}

/** 从合法输入构造 status=defined 的起点记录（经 domain experimentFromInput）。 */
export function baseExperiment(
  overrides: Partial<Experiment> = {},
  inputOverrides: Partial<ExperimentInput> = {},
): Experiment {
  return {
    ...experimentFromInput(baseInput(inputOverrides), { now: T1, id: "exp-1" }),
    ...overrides,
  };
}

/** 手工构造的完整记录（domain 层防御测试用：模拟损坏/旁路记录，不经任何写路径）。 */
export function handBuiltExperiment(
  overrides: Partial<Experiment> = {},
): Experiment {
  return {
    id: "exp-handbuilt",
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    hypothesis_id: null,
    statement: "Pricing page A increases qualified inbound leads vs page B.",
    design: { method: "ab_test" },
    assignment: null,
    measurement_evidence_refs: [],
    status: "defined",
    outcome: null,
    outcome_note: null,
    started_at: null,
    concluded_at: null,
    created_at: T1,
    updated_at: T1,
    ...overrides,
  };
}

/** 按 @mos/contracts hypothesisSchema 形状逐字构造的当前假设记录（组合根供给）。 */
export function baseHypothesis(
  overrides: Partial<Hypothesis> = {},
): Hypothesis {
  return {
    id: HYPOTHESIS_ID,
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    statement: "Publishing pricing pages increases qualified inbound leads.",
    rationale: "Research findings mention pricing uncertainty.",
    evidence_refs: ["evidence:hubspot-contacts-export"],
    proposed_route_ids: [],
    status: "proposed",
    experiment_ref: null,
    created_at: T1,
    updated_at: T1,
    ...overrides,
  };
}
