/**
 * mos-engines 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；registry 的 class 形状由 src/application/engine-registry.ts
 * 声明，本文件不声明 store/服务方法（与 W2 各包 contract.ts 同模式）。
 */
import type { Engine, EngineStatus, Money } from "@mos/contracts";

export type { Engine, EngineStatus, Money } from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  EngineRegistrationInput,
} from "./contract/engine.js";
export { EngineNotFoundError, EngineValidationError } from "./contract/engine.js";

export type {
  SandboxPolicy,
  SandboxFilesystemScope,
} from "./contract/sandbox-policy.js";
export {
  SANDBOX_FILESYSTEM_SCOPES,
  SandboxPolicyValidationError,
  sandboxPolicySchema,
  sandboxFilesystemScopeSchema,
  validateSandboxPolicy,
} from "./contract/sandbox-policy.js";

/**
 * 时钟注入缝（RFC3339 UTC）：结构上与底物 TimePort 同形，
 * 组合根可直接转发；本包不依赖 zcode-mos-adapters。
 */
export interface TimeSource {
  now(): string;
}
