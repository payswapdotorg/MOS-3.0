/**
 * mos-content-artifacts 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store 方法（W2 模式，≤300 行）。
 */
import type {
  ActorKind,
  Artifact,
  ArtifactKind,
  QualityStatus,
  RightsStatus,
} from "@mos/contracts";

export type {
  ActorKind,
  Artifact,
  ArtifactKind,
  QualityStatus,
  RightsStatus,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type { ArtifactVersionInput, ArtifactRecord } from "./contract/artifact.js";
export {
  ArtifactNotFoundError,
  ArtifactValidationError,
  ArtifactVersionConflictError,
  artifactRecordSchema,
  artifactVersionInputSchema,
} from "./contract/artifact.js";

/** 版本注册的注入依赖：created_at 由调用方提供（领域层零 Date/random）。 */
export interface ArtifactVersionDeps {
  readonly now: string;
}
