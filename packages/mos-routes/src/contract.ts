/**
 * mos-routes 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；本文件不声明接口/类方法（≤300 行）。
 * 与 store/service 装配相关的 class 形状由 src/application/* 声明，
 * 保证 contract 层不反向依赖 domain/application。
 */
export type {
  Route,
  RouteClass,
  RouteStatus,
  SideEffect,
  Mission,
  CapabilityInstance,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";
export type {
  RouteInstanceFact,
  EvaluateRouteCandidatesInput,
  RouteCandidateSummary,
  RouteCandidateEvaluation,
} from "./contract/route-input.js";
