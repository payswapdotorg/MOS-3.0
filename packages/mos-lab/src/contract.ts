/**
 * mos-lab 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；本文件除 intake/proposal 的注入 deps 形状外不声明
 * 接口/类方法（与 mos-missions 的 contract.ts 同模式），store/service 装配相关的
 * class 形状由 src/application/* 声明，保证 contract 层不反向依赖 domain/application。
 */
export type {
  ResearchNote,
  ResearchFinding,
  Hypothesis,
  Mission,
  Route,
  RouteClass,
  NodeOffer,
  EvidenceKind,
  DomainEvent,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type { ResearchNoteIntake, EvidenceLookup } from "./contract/research.js";

export type { HypothesisProposal, MissionLookup } from "./contract/hypothesis.js";
export { MissionNotFoundError, HypothesisNotFoundError } from "./contract/hypothesis.js";

export type {
  RouteCandidateFact,
  LabProgramSuggestion,
  ProgramDiscoveryInput,
  DeriveProgramSuggestionsInput,
  HypothesisLookup,
  RouteLookup,
  OfferLookup,
} from "./contract/program-discovery.js";
export { RouteNotFoundError } from "./contract/program-discovery.js";

export type {
  TimePort,
  LabWritableHypothesisStatus,
  SuggestibleRouteClass,
} from "./contract/lab-vocabulary.js";

/** 逐字 intake 的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface ResearchNoteIntakeDeps {
  readonly now: string;
  readonly id: string;
}

/** 假设提案的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface HypothesisProposalDeps {
  readonly now: string;
  readonly id: string;
}
