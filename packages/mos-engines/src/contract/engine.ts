import { z } from "zod";
import {
  ContractValidationError,
  engineStatusSchema,
  moneySchema,
  opaqueIdSchema,
} from "@mos/contracts";

/**
 * Engine 写边界契约（core-contracts §Engine 的注册投影；authority: engines）。
 *
 * - EngineRegistrationInput 是注册/更新命令的业务字段：id 与 tenant_id 不在输入里，
 *   由 EngineRegistry.register(tenantId, engineId, input) 的方法参数提供。
 * - sandbox_policy 以原始 record 进入（与共享 engineSchema 的 record 形状一致），
 *   在写边界经 validateSandboxPolicy fail-closed 校验后以规范化描述符落库。
 * - 决策锁 #9：本包只有注册表记录；不导入任何具体 engine，也没有任何调用路径。
 */

/** Engine 注册/更新命令输入（verbatim intake；缺失可空字段 = null/[]，绝不猜测）。 */
export const engineRegistrationInputSchema = z.object({
  display_name: z.string().min(1),
  capability_ids: z.array(opaqueIdSchema).default([]),
  provider_id: opaqueIdSchema.nullable().default(null),
  sandbox_policy: z.record(z.string(), z.unknown()),
  benchmark_refs: z.array(z.string().min(1)).default([]),
  license_terms: z.string().nullable().default(null),
  cost_model: moneySchema.nullable().default(null),
  status: engineStatusSchema,
});
export type EngineRegistrationInput = z.infer<typeof engineRegistrationInputSchema>;

/** Engine 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class EngineNotFoundError extends Error {
  constructor(public readonly engineId: string) {
    super(`engine not found: ${engineId}`);
    this.name = "EngineNotFoundError";
  }
}

/** Engine 写边界校验失败（fail-closed；ContractValidationError 的类型化投影，绝不静默修正字段）。 */
export class EngineValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Engine", [...issues]);
    this.name = "EngineValidationError";
  }
}
