import { z } from "zod";
import { ContractValidationError, opaqueIdSchema } from "@mos/contracts";
import type { ProductStatus } from "@mos/contracts";

/**
 * mos-commerce 契约 —— CommerceProduct（商业产品）的写入词汇与类型化错误。
 * artifact 血统只持不透明引用（W3 content-artifacts 记录由组合根解析）。
 */

/** 产品登记输入（id/now 注入；登记恒为 draft）。 */
export const productRegistrationInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  artifact_refs: z.array(z.string().min(1)).default([]),
});
export type ProductRegistrationInput = z.infer<typeof productRegistrationInputSchema>;

/** 生命周期词表（与 @mos/contracts productStatusSchema 同源）。 */
export const PRODUCT_STATUS_DRAFT = "draft" as const;
export const PRODUCT_STATUS_ACTIVE = "active" as const;
export const PRODUCT_STATUS_RETIRED = "retired" as const;

/** 产品不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测）。 */
export class ProductNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly productId: string,
  ) {
    super(`commerce product ${productId} not found for tenant ${tenantId}`);
    this.name = "ProductNotFoundError";
  }
}

/** 产品登记/记录校验失败（ContractValidationError 的类型化投影）。 */
export class ProductValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("CommerceProduct", [...issues]);
    this.name = "ProductValidationError";
  }
}

/** 非法状态转移（fail-closed）：携带具名 current/target。 */
export class ProductTransitionError extends Error {
  constructor(
    public readonly current: ProductStatus,
    public readonly target: ProductStatus,
  ) {
    super(`illegal commerce product transition: ${current} -> ${target}`);
    this.name = "ProductTransitionError";
  }
}
