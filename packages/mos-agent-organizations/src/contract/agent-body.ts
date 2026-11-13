import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import { actorKindSchema, opaqueIdSchema } from "@mos/contracts";

/**
 * AgentBody 写边界契约（core-contracts §AgentBody 的 intake 投影，authority: agent-organizations）。
 * 逐字 intake：未提供的可空字段保持 null（缺失绝不猜测），数组逐字保存；
 * status 不由注册命令决定（注册恒为 active，其余状态经后续 upsert 表达）。
 */

/** AgentBody 注册命令（verbatim input, explicit nulls；组织/角色未知时保持 null）。 */
export const agentBodyRegistrationSchema = z.object({
  tenant_id: opaqueIdSchema,
  kind: actorKindSchema,
  display_name: z.string().min(1),
  organization_id: opaqueIdSchema.nullable(),
  role: z.string().nullable(),
  evidenced_capability_ids: z.array(opaqueIdSchema),
});
export type AgentBodyRegistration = z.infer<typeof agentBodyRegistrationSchema>;

/** 注册恒为 active（W2 词表；inactive/unknown 属于后续生命周期，不经注册命令注入）。 */
export const AGENT_BODY_STATUS_ACTIVE = "active" as const;

/** AgentBody 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class AgentBodyNotFoundError extends Error {
  constructor(public readonly agentBodyId: string) {
    super(`agent body not found: ${agentBodyId}`);
    this.name = "AgentBodyNotFoundError";
  }
}

/** AgentBody 写边界校验失败（fail-closed；是 ContractValidationError 的类型化投影，绝不静默修正字段）。 */
export class AgentBodyValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("AgentBody", [...issues]);
    this.name = "AgentBodyValidationError";
  }
}
