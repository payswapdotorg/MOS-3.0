import { z } from "zod";
import {
  ContractValidationError,
  engineStatusSchema,
  opaqueIdSchema,
  productionGraphEdgeSchema,
  productionGraphNodeSchema,
  transformStatusSchema,
} from "@mos/contracts";
import type { EngineStatus, TransformStatus } from "@mos/contracts";

/**
 * ProductionGraph 写边界契约（core-contracts §ProductionGraph；authority: production）。
 *
 * - GraphInput 只是图结构输入（name / mission_id / nodes / edges）：id、tenant、版本与
 *   校验状态由 GraphStore 管理（saveDraft 恒为 draft；validated 只能经 validate 门禁达到）。
 * - transform / engine 节点的 ref 是不透明 id（决策锁 #9）：存在性与状态解析经结构化
 *   lookup 端口（TransformLookup / EngineLookup）注入——本包绝不 import @mos/engines，
 *   组合根负责把端口接到 engines/production 各自的注册表存储。
 * - 全部校验错误具名收集（domain/graph-validation.ts），绝不静默丢弃；
 *   GraphValidationError 携带具名 validation_errors。
 */

/** 图结构输入：节点/边逐字保存（saveDraft 恒为 draft，不在此处校验 DAG/引用）。 */
export const graphInputSchema = z.object({
  name: z.string().min(1),
  mission_id: opaqueIdSchema.nullable().default(null),
  nodes: z.array(productionGraphNodeSchema).default([]),
  edges: z.array(productionGraphEdgeSchema).default([]),
});
export type GraphInput = z.infer<typeof graphInputSchema>;

/**
 * Transform 查找端口：结构化注入（无 @mos/engines 导入、无 provider I/O）。
 * 端口按 (tenantId, transformId) 解析：transform 存在且属于该 tenant 才返回
 * { status }，否则 undefined（他租户 transform 与不存在的 transform 同义——
 * fail-closed，不泄露跨租户存在性）。
 */
export type TransformLookup = (
  tenantId: string,
  transformId: string,
) => { status: TransformStatus } | undefined;

/**
 * Engine 查找端口：结构化注入（决策锁 #9——绝不 import @mos/engines）。
 * 端口按 (tenantId, engineId) 解析：engine 存在且属于该 tenant 才返回 { status }，
 * 否则 undefined（他租户 engine 与不存在的 engine 同义——fail-closed）。
 */
export type EngineLookup = (
  tenantId: string,
  engineId: string,
) => { status: EngineStatus } | undefined;

/** 图不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class GraphNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly graphId: string,
  ) {
    super(`production graph ${graphId} not found for tenant ${tenantId}`);
    this.name = "GraphNotFoundError";
  }
}

/** 图校验失败（fail-closed）：携带具名 validation_errors（与落盘的 validation_errors 同源）。 */
export class GraphValidationError extends ContractValidationError {
  constructor(public readonly validationErrors: readonly string[]) {
    super("ProductionGraph", [...validationErrors]);
    this.name = "GraphValidationError";
  }
}
