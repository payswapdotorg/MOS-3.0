import {
  assertExperimentOutcomeEvidence,
  experimentSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Experiment, ExperimentStatus } from "@mos/contracts";
import {
  concludeExperimentInputSchema,
  EXPERIMENT_STATUS_ANALYZED,
  EXPERIMENT_STATUS_ASSIGNED,
  EXPERIMENT_STATUS_CANCELLED,
  EXPERIMENT_STATUS_CONCLUDED,
  EXPERIMENT_STATUS_DEFINED,
  EXPERIMENT_STATUS_MEASURING,
  experimentInputSchema,
  experimentTransitionSchema,
  ExperimentTransitionError,
  OutcomeEvidenceRequiredError,
} from "../contract/experiment.js";
import type {
  ConcludeExperimentInput,
  ExperimentInput,
  ExperimentTransitionInput,
} from "../contract/experiment.js";
import type {
  ExperimentCreationDeps,
  ExperimentTransitionDeps,
} from "../contract.js";

/**
 * Experiment 生命周期纯状态机（零 I/O、零 Date/random、零 provider 调用——决策锁 #8）。
 *
 * 合法边（其余一律 ExperimentTransitionError，具名 current/target）：
 * - defined→assigned（必须携带 assignment record）；
 * - assigned→measuring（记录 started_at，只补不覆盖）；
 * - measuring→analyzed；
 * - analyzed→concluded：**只能经 concludeExperiment**（直接 target=concluded →
 *   ExperimentTransitionError；outcome 只在这一条路径可写——决策锁 #18 单一结果 authority）；
 * - any→cancelled：defined/assigned/measuring/analyzed 均可取消；concluded 是
 *   有证据支撑的历史结论、cancelled 是终态，二者不再转出（与不变量 §21 一致：
 *   outcome 非 null ⇒ status 必须是 concluded，取消已收尾的实验必然造出违约记录）；
 * - unknown 无出边（fail-closed，绝不猜测 unknown 记录的含义）。
 */

/** 合法转移表（具名状态机）。 */
export const LEGAL_EXPERIMENT_TRANSITIONS: Readonly<
  Record<ExperimentStatus, readonly ExperimentStatus[]>
> = {
  defined: [EXPERIMENT_STATUS_ASSIGNED, EXPERIMENT_STATUS_CANCELLED],
  assigned: [EXPERIMENT_STATUS_MEASURING, EXPERIMENT_STATUS_CANCELLED],
  measuring: [EXPERIMENT_STATUS_ANALYZED, EXPERIMENT_STATUS_CANCELLED],
  analyzed: [EXPERIMENT_STATUS_CONCLUDED, EXPERIMENT_STATUS_CANCELLED],
  concluded: [],
  cancelled: [],
  unknown: [],
};

/** 判定 (current, target) 是否合法边。 */
export function isLegalExperimentTransition(
  current: ExperimentStatus,
  target: ExperimentStatus,
): boolean {
  return (
    LEGAL_EXPERIMENT_TRANSITIONS[current] as readonly ExperimentStatus[]
  ).includes(target);
}

/**
 * 创建输入 → Experiment（纯函数）：恒为 status=defined、assignment=null、
 * measurement_evidence_refs=[]、outcome/outcome_note/concluded_at/started_at=null
 * （结果语义在创建形状上即不可表达——决策锁 #18）；
 * mission_id / hypothesis_id 未提供保持 null；statement / design 逐字保存。
 */
export function experimentFromInput(
  input: ExperimentInput,
  deps: ExperimentCreationDeps,
): Experiment {
  const normalized = parseOrFail(
    "ExperimentInput",
    experimentInputSchema,
    input,
  ) as ExperimentInput;
  const experiment: Experiment = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    mission_id: normalized.mission_id,
    hypothesis_id: normalized.hypothesis_id,
    statement: normalized.statement,
    design: { ...normalized.design },
    assignment: null,
    measurement_evidence_refs: [],
    status: EXPERIMENT_STATUS_DEFINED,
    outcome: null,
    outcome_note: null,
    started_at: null,
    concluded_at: null,
    created_at: deps.now,
    updated_at: deps.now,
  };
  return parseOrFail("Experiment", experimentSchema, experiment) as Experiment;
}

/**
 * 生命周期转移（纯函数）：
 * - 直接 target=concluded 一律拒绝（outcome 只能经 concludeExperiment 写入）；
 * - defined→assigned 必须携带 assignment record（schema 强制非 null）；
 * - 非法边 → ExperimentTransitionError（具名 current/target）。
 */
export function applyExperimentTransition(
  experiment: Experiment,
  transition: ExperimentTransitionInput,
  deps: ExperimentTransitionDeps,
): Experiment {
  // 运行时防御：concluded 不是 union 的合法变体，直接点名拒绝（决策锁 #18）。
  const rawTarget = (transition as { target?: unknown } | null | undefined)?.target;
  if (rawTarget === EXPERIMENT_STATUS_CONCLUDED) {
    throw new ExperimentTransitionError(
      experiment.status,
      EXPERIMENT_STATUS_CONCLUDED,
      "outcome 只能经 concludeExperiment 写入（决策锁 #18 单一结果 authority）",
    );
  }

  const parsed = parseOrFail(
    "ExperimentTransition",
    experimentTransitionSchema,
    transition,
  ) as ExperimentTransitionInput;

  if (!isLegalExperimentTransition(experiment.status, parsed.target)) {
    throw new ExperimentTransitionError(experiment.status, parsed.target);
  }

  const next: Experiment = {
    ...experiment,
    status: parsed.target,
    // assigned 必带 assignment；measuring 只补不覆盖 started_at；其余保持原值。
    assignment:
      parsed.target === EXPERIMENT_STATUS_ASSIGNED ? parsed.assignment : experiment.assignment,
    started_at:
      parsed.target === EXPERIMENT_STATUS_MEASURING && experiment.started_at === null
        ? deps.now
        : experiment.started_at,
    updated_at: deps.now,
  };
  return parseOrFail("Experiment", experimentSchema, next) as Experiment;
}

/**
 * 收尾（决策锁 #18 的唯一 outcome 写入路径；纯函数）：
 * - 状态必须是 analyzed（其余 → ExperimentTransitionError：outcome before concluded
 *   一律拒绝——未收尾的实验绝不携带结果）；
 * - measurement evidence refs 为空 → OutcomeEvidenceRequiredError（具名缺失项）；
 * - 产物：status=concluded + outcome + outcome_note + measurement_evidence_refs
 *   （逐字复制）+ concluded_at，并调用 assertExperimentOutcomeEvidence 终守卫
 *   （不变量 §21）。
 */
export function concludeExperiment(
  experiment: Experiment,
  input: ConcludeExperimentInput,
  deps: ExperimentTransitionDeps,
): Experiment {
  if (experiment.status !== EXPERIMENT_STATUS_ANALYZED) {
    throw new ExperimentTransitionError(experiment.status, EXPERIMENT_STATUS_CONCLUDED);
  }
  const normalized = parseOrFail(
    "ConcludeExperimentInput",
    concludeExperimentInputSchema,
    input,
  ) as ConcludeExperimentInput;
  if (normalized.evidence_refs.length === 0) {
    throw new OutcomeEvidenceRequiredError(experiment.id, ["measurement_evidence_refs"]);
  }

  const concluded: Experiment = {
    ...experiment,
    status: EXPERIMENT_STATUS_CONCLUDED,
    outcome: normalized.outcome,
    outcome_note: normalized.outcome_note,
    measurement_evidence_refs: [...normalized.evidence_refs],
    concluded_at: normalized.concluded_at,
    updated_at: deps.now,
  };
  // 不变量 §21 终守卫（defense in depth：store 落盘前还会对每条记录再跑一次）。
  assertExperimentOutcomeEvidence(concluded);
  return parseOrFail("Experiment", experimentSchema, concluded) as Experiment;
}
