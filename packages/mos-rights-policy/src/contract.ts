/**
 * mos-rights-policy 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store/service 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store/服务方法（W2 模式，≤300 行）。
 */
import type { RightsDecision, RightsKind, RightsRecord } from "@mos/contracts";

export type { RightsDecision, RightsKind, RightsRecord } from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  RightsRecordInput,
  RightsRecordRecord,
  RightsRecordWritableKind,
  TimePort,
} from "./contract/rights.js";
export {
  RightsRecordNotFoundError,
  RightsValidationError,
  RIGHTS_RECORD_WRITABLE_KINDS,
  rightsRecordInputSchema,
  rightsRecordRecordSchema,
} from "./contract/rights.js";

export type {
  RightsGateDenyReason,
  RightsGateReason,
  RightsGateVerdict,
} from "./domain/rights-gate.js";
export {
  evaluateRightsGate,
  RIGHTS_GATE_DENY_REASONS,
} from "./domain/rights-gate.js";

/** 权利记录写入的注入依赖：记录 id 与时间由调用方提供（领域层零 Date/random）。 */
export interface RightsRecordDeps {
  readonly id: string;
  readonly now: string;
}
