import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import { opaqueIdSchema } from "@mos/contracts";

/**
 * Organization 写边界契约（core-contracts §Organization 的 intake 投影）。
 * 逐字 intake：description 未知时保持 null；status 不由注册命令决定（注册恒为 active）。
 */

/** Organization 注册命令（verbatim input, explicit nulls）。 */
export const organizationRegistrationSchema = z.object({
  tenant_id: opaqueIdSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type OrganizationRegistration = z.infer<typeof organizationRegistrationSchema>;

/** 注册恒为 active（W2 词表；inactive/unknown 属于后续生命周期，不经注册命令注入）。 */
export const ORGANIZATION_STATUS_ACTIVE = "active" as const;

/** Organization 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class OrganizationNotFoundError extends Error {
  constructor(public readonly organizationId: string) {
    super(`organization not found: ${organizationId}`);
    this.name = "OrganizationNotFoundError";
  }
}

/** Organization 写边界校验失败（fail-closed；是 ContractValidationError 的类型化投影）。 */
export class OrganizationValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Organization", [...issues]);
    this.name = "OrganizationValidationError";
  }
}
