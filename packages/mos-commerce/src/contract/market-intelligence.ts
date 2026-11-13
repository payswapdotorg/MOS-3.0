import { z } from "zod";
import { ContractValidationError, opaqueIdSchema } from "@mos/contracts";
import { rfc3339TimestampSchema } from "@mos/contracts";

/**
 * mos-commerce 契约 —— MarketIntelligenceRecord（客户/市场情报）的写入词汇与类型化错误。
 *
 * 不变量 §25：情报绝不携带无证据事实 —— intake 层 evidence_refs 即 min(1)
 * （fail-closed schema），领域层再跑 §25 终守卫（defense in depth）。
 * subject_ref 一律不透明引用（客户/细分市场/区域），记录内零 PII（AGENTS.md §4）。
 */

/** 情报写入输入（observed_at 必填 —— 外部事实必须带观察时间，契约 conventions）。 */
export const marketIntelligenceIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  topic: z.string().min(1),
  subject_ref: z.string().min(1),
  facts: z.record(z.string(), z.unknown()),
  evidence_refs: z.array(z.string().min(1)).min(1),
  insight: z.string().nullable(),
  confidence: z.number().nullable(),
  limitations: z.array(z.string().min(1)).default([]),
  observed_at: rfc3339TimestampSchema,
});
export type MarketIntelligenceIntake = z.infer<typeof marketIntelligenceIntakeSchema>;

/** 情报写入/记录校验失败（含 §25 证据缺失 —— schema min(1) fail-closed）。 */
export class MarketIntelligenceValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("MarketIntelligenceRecord", [...issues]);
    this.name = "MarketIntelligenceValidationError";
  }
}
