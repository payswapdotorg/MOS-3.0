/**
 * mos-distribution 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store 方法（与 mos-lab / mos-agent-organizations 的 contract.ts 同模式）。
 */
import type {
  ApprovalState,
  DistributionIntent,
  DistributionStatus,
  ExternalActionPreview,
} from "@mos/contracts";

export type {
  ApprovalState,
  DistributionIntent,
  DistributionStatus,
  ExternalActionPreview,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  DistributionOperation,
  DistributionIntentInput,
  PreviewBinding,
} from "./contract/intent.js";
export {
  DISTRIBUTION_OPERATIONS,
  DISTRIBUTION_STATUS_INTENT,
  DISTRIBUTION_STATUS_PREVIEWED,
  DISTRIBUTION_STATUS_PENDING_APPROVAL,
  DISTRIBUTION_STATUS_APPROVED,
  DISTRIBUTION_STATUS_REJECTED,
  DISTRIBUTION_STATUS_EXECUTING,
  DISTRIBUTION_STATUS_SUCCEEDED,
  DISTRIBUTION_STATUS_FAILED,
  DISTRIBUTION_APPROVAL_PENDING,
  DISTRIBUTION_APPROVAL_APPROVED,
  DISTRIBUTION_APPROVAL_REJECTED,
  IntentNotFoundError,
  IntentValidationError,
  PreviewRequiredError,
  ApprovalRequiredError,
  IdempotencyConflictError,
  IntentTransitionError,
} from "./contract/intent.js";

/** 意图创建的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface IntentCreationDeps {
  readonly id: string;
  readonly now: string;
}

/** 状态机/证据追加的注入依赖：时间由调用方提供（领域层零 Date/random 依赖）。 */
export interface IntentTransitionDeps {
  readonly now: string;
}
