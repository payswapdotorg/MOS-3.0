import { z } from "zod";
import {
  ContractValidationError,
  opaqueIdSchema,
  riskLevelSchema,
  sideEffectSchema,
  transformStatusSchema,
} from "@mos/contracts";

/**
 * Transform 写边界契约（core-contracts §Transform 的注册投影；authority: production）。
 *
 * - TransformDefinitionInput 是注册/更新命令的业务字段：id 与 tenant_id 不在输入里，
 *   由 TransformRegistry.register(tenantId, transformId, input) 的方法参数提供。
 * - 逐字 intake：description / required_capability_id 未提供 = null（绝不猜测）；
 *   parameters_schema 是参数形状描述（JSON-Schema 风格 record，逐字保存）。
 * - Transform 只是“期望操作定义”，不是执行：执行归 ZCode（决策锁 #5）。
 */

/** Transform 定义输入（verbatim intake；status 由 transformStatusSchema 封闭词表约束）。 */
export const transformDefinitionInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  parameters_schema: z.record(z.string(), z.unknown()).default({}),
  required_capability_id: opaqueIdSchema.nullable().default(null),
  side_effect: sideEffectSchema,
  risk_level: riskLevelSchema,
  status: transformStatusSchema,
});
export type TransformDefinitionInput = z.infer<typeof transformDefinitionInputSchema>;

/** Transform 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class TransformNotFoundError extends Error {
  constructor(public readonly transformId: string) {
    super(`transform not found: ${transformId}`);
    this.name = "TransformNotFoundError";
  }
}

/** Transform 写边界校验失败（fail-closed；ContractValidationError 的类型化投影，绝不静默修正字段）。 */
export class TransformValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Transform", [...issues]);
    this.name = "TransformValidationError";
  }
}
