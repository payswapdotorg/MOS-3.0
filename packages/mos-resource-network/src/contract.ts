/**
 * mos-resource-network 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store 方法（与 mos-lab / mos-distribution 的 contract.ts 同模式）。
 */
export type {
  Gig,
  GigStatus,
  NetworkNode,
  NetworkNodeStatus,
  ExecutionOption,
  ExecutionOptionKind,
  ExecutionOptionAdequacy,
  ExecutionRecommendation,
  RouteComparison,
  NodeRef,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  GigIntake,
  GigAssignmentInput,
  GigAssignment,
  GigCreationDeps,
  GigTransitionDeps,
} from "./contract/gig.js";
export {
  GIG_STATUS_DRAFT,
  GIG_STATUS_PUBLISHED,
  GIG_STATUS_ASSIGNED,
  GIG_STATUS_IN_PROGRESS,
  GIG_STATUS_DELIVERED,
  GIG_STATUS_ACCEPTED,
  GIG_STATUS_REJECTED,
  GIG_STATUS_CANCELLED,
  GigNotFoundError,
  GigValidationError,
  RouteComparisonValidationError,
  GigPublishBlockedError,
  GigAssignmentBlockedError,
  GigTransitionError,
} from "./contract/gig.js";

export type {
  NetworkNodeRegistrationInput,
  OfferLookup,
  EngineLookup,
} from "./contract/network-node.js";
export {
  NETWORK_NODE_STATUS_ACTIVE,
  NETWORK_NODE_STATUS_INACTIVE,
  NetworkNodeNotFoundError,
  NetworkNodeValidationError,
} from "./contract/network-node.js";
