import { z } from "zod";
import {
  actorKindSchema,
  agentBodyStatusSchema,
  offerStatusSchema,
  organizationStatusSchema,
} from "./enums.js";
import { opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * AgentBody / Organization / NodeOffer —— core-contracts-v3.0.yaml §objects
 * （Week 2 additive；authority: agent-organizations，见 module-registry-v3.0.yaml）。
 *
 * NodeOffer 是 architecture §8 "economic and human execution" 的服务要约对象：
 * 发布是 fail-closed 门禁（§8 全部披露字段缺失/未知 → 只能停在 draft），
 * 守卫见 domain/invariants.ts 的 assertNodeOfferPublishable。
 */

/** 节点引用：human/agent/engine/tool/organization/team 的不透明 id + 种类。 */
export const nodeRefSchema = z.object({
  kind: actorKindSchema,
  id: opaqueIdSchema,
});
export type NodeRef = z.infer<typeof nodeRefSchema>;

/** AgentBody —— 具名执行体（人/代理/引擎/工具等在租户内的登记）。 */
export const agentBodySchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  kind: actorKindSchema,
  display_name: z.string().min(1),
  organization_id: opaqueIdSchema.nullable().default(null),
  role: z.string().nullable().default(null),
  evidenced_capability_ids: z.array(opaqueIdSchema).default([]),
  status: agentBodyStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type AgentBody = z.infer<typeof agentBodySchema>;

/** Organization —— 租户内的组织/团队登记。 */
export const organizationSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  status: organizationStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

/** §8 要求的可用性披露：显式 unknown（null）而不是猜测。 */
export const offerAvailabilitySchema = z.object({
  windows: z.string().nullable(),
  capacity: z.string().nullable(),
});
export type OfferAvailability = z.infer<typeof offerAvailabilitySchema>;

/** §8 要求的验收评估披露。 */
export const offerAcceptanceEvaluatorSchema = z.object({
  evaluator_ref: z.string().min(1),
  method: z.string().min(1),
});
export type OfferAcceptanceEvaluator = z.infer<typeof offerAcceptanceEvaluatorSchema>;

/**
 * NodeOffer —— architecture §8 服务要约。
 * 发布门禁（invariants §14）：deliverables/availability/geography/language/price_reward/
 * deadline/sla/rights_constraints/acceptance_evaluator/evidence_refs/delivery_history
 * 全部显式披露（未知值保持 null + 明确缺失清单）才允许 status=published。
 */
export const nodeOfferSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  node_ref: nodeRefSchema,
  capability_id: opaqueIdSchema,
  inputs: z.array(z.string().min(1)).default([]),
  deliverables: z.array(z.string().min(1)).default([]),
  availability: offerAvailabilitySchema,
  geography: z.string().nullable(),
  language: z.string().nullable(),
  price_reward: z
    .object({
      amount: z.string().regex(/^-?\d+(\.\d+)?$/),
      currency: z.string().length(3).regex(/^[A-Z]{3}$/),
    })
    .nullable(),
  deadline: rfc3339TimestampSchema.nullable(),
  sla: z.string().nullable(),
  rights_constraints: z.array(z.string().min(1)).default([]),
  acceptance_evaluator: offerAcceptanceEvaluatorSchema,
  evidence_refs: z.array(z.string().min(1)).default([]),
  delivery_history: z.array(z.string().min(1)).default([]),
  status: offerStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type NodeOffer = z.infer<typeof nodeOfferSchema>;

/** §8 披露门禁的完整清单（与 assertNodeOfferPublishable 保持一致）。 */
export const NODE_OFFER_REQUIRED_DISCLOSURES = [
  "capability_id",
  "deliverables",
  "availability",
  "geography",
  "language",
  "price_reward",
  "deadline",
  "sla",
  "rights_constraints",
  "acceptance_evaluator",
  "evidence_refs",
  "delivery_history",
] as const;
