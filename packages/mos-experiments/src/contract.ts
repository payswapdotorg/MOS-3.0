/**
 * mos-experiments 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store/service 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store/service 方法（与 mos-lab / mos-agent-organizations 的 contract.ts 同模式）。
 */
export type {
  Experiment,
  ExperimentOutcome,
  ExperimentStatus,
  Hypothesis,
  HypothesisStatus,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  ExperimentInput,
  ExperimentTransitionInput,
  ConcludeExperimentInput,
  HypothesisAdoptionReason,
} from "./contract/experiment.js";
export {
  EXPERIMENT_STATUS_DEFINED,
  EXPERIMENT_STATUS_ASSIGNED,
  EXPERIMENT_STATUS_MEASURING,
  EXPERIMENT_STATUS_ANALYZED,
  EXPERIMENT_STATUS_CONCLUDED,
  EXPERIMENT_STATUS_CANCELLED,
  ExperimentNotFoundError,
  ExperimentValidationError,
  ExperimentTransitionError,
  OutcomeEvidenceRequiredError,
  HypothesisAdoptionError,
} from "./contract/experiment.js";

export type {
  AdoptedHypothesis,
  HypothesisUpdatePort,
  AdoptHypothesisInput,
  AdoptionDeps,
  AdoptionExperimentView,
} from "./contract/adoption.js";

/** 实验定义的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface ExperimentCreationDeps {
  readonly id: string;
  readonly now: string;
}

/** 生命周期转移 / 收尾 / 采纳链接的注入依赖：时间由调用方提供（领域层零 Date/random 依赖）。 */
export interface ExperimentTransitionDeps {
  readonly now: string;
}
