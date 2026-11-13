/**
 * mos-production 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store/服务方法（与 W2 各包 contract.ts 同模式）。
 */
export type {
  EngineStatus,
  ProductionGraph,
  ProductionGraphNode,
  ProductionGraphEdge,
  ProductionGraphStatus,
  ProductionJob,
  ProductionJobStatus,
  ProductionNodeKind,
  RiskLevel,
  SideEffect,
  Transform,
  TransformStatus,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type { TransformDefinitionInput } from "./contract/transform.js";
export { TransformNotFoundError, TransformValidationError } from "./contract/transform.js";

export type { GraphInput, TransformLookup, EngineLookup } from "./contract/graph.js";
export { GraphNotFoundError, GraphValidationError, graphInputSchema } from "./contract/graph.js";

export type {
  JobCreationInput,
  ProductionJobEvent,
  ProductionJobEventKind,
  GraphLookup,
} from "./contract/job.js";
export {
  JobCreationBlockedError,
  JobEventValidationError,
  JobNotFoundError,
  JobTransitionError,
  PRODUCTION_JOB_EVENT_KINDS,
  jobCreationInputSchema,
  productionJobEventSchema,
} from "./contract/job.js";

/**
 * 时间端口（结构化注入）：created_at / updated_at / validated_at 一律经端口获得，
 * 领域层零 Date/random。与底物 TimePort（{ now(): string }）同形——
 * 组合根可直接注入任一实现（结构性满足）。
 */
export interface TimePort {
  now(): string;
}
