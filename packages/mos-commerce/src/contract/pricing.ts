import { z } from "zod";
import { ContractValidationError, moneySchema, opaqueIdSchema } from "@mos/contracts";
import { rfc3339TimestampSchema } from "@mos/contracts";
import type { PriceStatus } from "@mos/contracts";

/**
 * mos-commerce 契约 —— PriceRecord（定价记录）的写入词汇与类型化错误。
 *
 * architecture §9 + 不变量 §24：定价历史 append-only —— 价格金额/模型/生效窗口
 * 创建后不可改写，替代/调价只能追加新记录（superseded_by 指向）；
 * 本包因此不提供任何 update API（无更新路径 = 最强的 append-only 强制）。
 */

/** 定价写入输入（创建恒为 active；id/now 注入）。 */
export const priceIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  product_id: opaqueIdSchema,
  price: moneySchema,
  pricing_model: z.enum(["one_time", "subscription", "usage_based", "revenue_share"]),
  effective_from: rfc3339TimestampSchema,
  effective_until: rfc3339TimestampSchema.nullable(),
  evidence_refs: z.array(z.string().min(1)).default([]),
});
export type PriceIntake = z.infer<typeof priceIntakeSchema>;

/** 生命周期词表（与 @mos/contracts priceStatusSchema 同源）。 */
export const PRICE_STATUS_ACTIVE = "active" as const;
export const PRICE_STATUS_RETIRED = "retired" as const;

/** 定价记录不存在（或不在调用方租户内）：类型化错误。 */
export class PriceNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly priceId: string,
  ) {
    super(`price record ${priceId} not found for tenant ${tenantId}`);
    this.name = "PriceNotFoundError";
  }
}

/** 定价写入/记录校验失败（ContractValidationError 的类型化投影）。 */
export class PriceValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("PriceRecord", [...issues]);
    this.name = "PriceValidationError";
  }
}

/** 同产品同模型的 active 定价窗口重叠：类型化冲突（fail-closed，绝不静默覆盖）。 */
export class PriceConflictError extends Error {
  constructor(
    public readonly productId: string,
    public readonly pricingModel: string,
    public readonly conflictingPriceId: string,
  ) {
    super(
      `active price window overlaps existing ${pricingModel} price ${conflictingPriceId} for product ${productId}`,
    );
    this.name = "PriceConflictError";
  }
}

/** 非法定价状态转移（fail-closed）。 */
export class PriceTransitionError extends Error {
  constructor(
    public readonly current: PriceStatus,
    public readonly target: PriceStatus,
  ) {
    super(`illegal price record transition: ${current} -> ${target}`);
    this.name = "PriceTransitionError";
  }
}
