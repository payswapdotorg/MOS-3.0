import { z } from "zod";
import {
  executionOptionAdequacySchema,
  executionOptionKindSchema,
  executionRecommendationSchema,
  gigStatusSchema,
  networkNodeStatusSchema,
  priceStatusSchema,
  pricingModelSchema,
  productStatusSchema,
} from "./enums.js";
import { moneySchema, opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";
import {
  nodeRefSchema,
  offerAcceptanceEvaluatorSchema,
  offerAvailabilitySchema,
} from "./agent-organization.js";

/**
 * Week 4 additive 契约对象 —— core-contracts-v3.0.yaml §objects
 * （economy / network capacity；authority 映射见 module-registry-v3.0.yaml：
 * resource-network / commerce）。
 *
 * 关键决策锁投影：
 * - 决策锁 #14（unknown 就是 unknown）：ExecutionOption.adequacy 的 unknown
 *   绝不算 adequate；§23 守卫在人工指派边界强制。
 * - 决策锁 #17（no-op/reuse 是真实路线）：execution_option_kind 含 no_op_reuse；
 *   路线比较必须覆盖它，缺比较 = 拒绝人工指派。
 * - architecture §8：Gig 是 Human Production Task Package 的逐字投影
 *   （objective / source refs / script-brief / capture-or-execution instructions /
 *   expected output / consent-rights / evaluator / deadline / budget-reward /
 *   expected value of waiting / alternative routes）。
 * - architecture §9：价格记录 append-only（§24 守卫）；金额/模型/生效窗口创建后不可变。
 */

/** NetworkNode —— 执行容量网络里的节点登记（发现用；kind + 不透明 ref 归各 authority 解析）。 */
export const networkNodeSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  node_ref: nodeRefSchema,
  display_name: z.string().min(1),
  evidenced_capability_ids: z.array(opaqueIdSchema).default([]),
  availability: offerAvailabilitySchema,
  geography: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  evidence_refs: z.array(z.string().min(1)).default([]),
  status: networkNodeStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type NetworkNode = z.infer<typeof networkNodeSchema>;

/** Gig —— architecture §8 Human Production Task Package（人工生产任务包）的持久记录。 */
export const gigSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  objective: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  script_brief: z.string().min(1),
  capture_or_execution_instructions: z.string().min(1),
  expected_output: z.string().min(1),
  consent_rights: z.array(z.string().min(1)).default([]),
  evaluator: offerAcceptanceEvaluatorSchema,
  deadline: rfc3339TimestampSchema.nullable().default(null),
  budget_reward: moneySchema.nullable().default(null),
  expected_value_of_waiting: moneySchema.nullable().default(null),
  alternative_route_ids: z.array(opaqueIdSchema).default([]),
  route_comparison: z.lazy(() => routeComparisonSchema).nullable().default(null),
  assigned_node_ref: nodeRefSchema.nullable().default(null),
  status: gigStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Gig = z.infer<typeof gigSchema>;

/**
 * ExecutionOption —— 路线比较里的单个候选（人工要约 / 代理要约 / 引擎 / no-op-reuse）。
 * adequacy 由调用方经既有路线评估（mos-routes）+ 能力实例解析提供；本对象只承载结论与理由，
 * 绝不在契约层自行猜测（unknown 绝不算 adequate）。
 */
export const executionOptionSchema = z.object({
  kind: executionOptionKindSchema,
  ref: opaqueIdSchema,
  estimated_cost: moneySchema.nullable().default(null),
  estimated_latency_ms: z.number().int().min(0).nullable().default(null),
  adequacy: executionOptionAdequacySchema,
  inadequacy_reason: z.string().nullable().default(null),
});
export type ExecutionOption = z.infer<typeof executionOptionSchema>;

/** RouteComparison —— §8 路线比较记录（人工指派的唯一凭证；§23 守卫的输入）。 */
export const routeComparisonSchema = z.object({
  compared_options: z.array(executionOptionSchema).min(1),
  recommendation: executionRecommendationSchema,
  evidence_refs: z.array(z.string().min(1)).default([]),
  compared_at: rfc3339TimestampSchema,
});
export type RouteComparison = z.infer<typeof routeComparisonSchema>;

/** CommerceProduct —— 商业产品（内容/artifact 血统只持不透明引用）。 */
export const commerceProductSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  artifact_refs: z.array(z.string().min(1)).default([]),
  status: productStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type CommerceProduct = z.infer<typeof commerceProductSchema>;

/** PriceRecord —— 定价记录（append-only：金额/模型/生效窗口创建后不可变，§24）。 */
export const priceRecordSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  product_id: opaqueIdSchema,
  price: moneySchema,
  pricing_model: pricingModelSchema,
  effective_from: rfc3339TimestampSchema,
  effective_until: rfc3339TimestampSchema.nullable().default(null),
  superseded_by: opaqueIdSchema.nullable().default(null),
  evidence_refs: z.array(z.string().min(1)).default([]),
  status: priceStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type PriceRecord = z.infer<typeof priceRecordSchema>;

/** MarketIntelligenceRecord —— 客户/市场情报（不透明 subject_ref；§25 证据门禁）。 */
export const marketIntelligenceRecordSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  topic: z.string().min(1),
  subject_ref: z.string().min(1),
  facts: z.record(z.string(), z.unknown()),
  evidence_refs: z.array(z.string().min(1)).default([]),
  insight: z.string().nullable().default(null),
  confidence: z.number().nullable().default(null),
  limitations: z.array(z.string().min(1)).default([]),
  observed_at: rfc3339TimestampSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type MarketIntelligenceRecord = z.infer<typeof marketIntelligenceRecordSchema>;
