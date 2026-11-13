import { z } from "zod";
import {
  moneySchema,
  nodeOfferSchema,
  nodeRefSchema,
  offerAcceptanceEvaluatorSchema,
  offerAvailabilitySchema,
  opaqueIdSchema,
  rfc3339TimestampSchema,
  NODE_OFFER_REQUIRED_DISCLOSURES,
} from "@mos/contracts";

/**
 * NodeOffer 写边界契约（architecture §8 服务要约；core-contracts §NodeOffer）。
 *
 * - 草稿输入的 §8 披露字段全部显式可空：null = 未披露（绝不猜测），
 *   空数组 = 显式"无"（字段级语义见 domain/offer-gate.ts）。
 * - 持久记录是 nodeOfferSchema 的超集（草稿期 §8 字段可保持 null）；
 *   status=published 的记录必须完整符合 nodeOfferSchema 契约——
 *   由发布门禁 + assertNodeOfferPublishable 双重 fail-closed 守卫。
 * - 发布门禁缺失字段名的权威清单是 @mos/contracts 的 NODE_OFFER_REQUIRED_DISCLOSURES。
 */

/** NodeOffer 草稿创建输入：node_ref（谁在要约）必填，§8 披露字段全部显式可空。 */
export const nodeOfferDraftInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  node_ref: nodeRefSchema,
  capability_id: opaqueIdSchema.nullable(),
  inputs: z.array(z.string().min(1)).nullable(),
  deliverables: z.array(z.string().min(1)).nullable(),
  availability: offerAvailabilitySchema.nullable(),
  geography: z.string().nullable(),
  language: z.string().nullable(),
  price_reward: moneySchema.nullable(),
  deadline: rfc3339TimestampSchema.nullable(),
  sla: z.string().nullable(),
  rights_constraints: z.array(z.string().min(1)).nullable(),
  acceptance_evaluator: offerAcceptanceEvaluatorSchema.nullable(),
  evidence_refs: z.array(z.string().min(1)).nullable(),
  delivery_history: z.array(z.string().min(1)).nullable(),
});
export type NodeOfferDraftInput = z.infer<typeof nodeOfferDraftInputSchema>;

/**
 * 持久 offer 记录：nodeOfferSchema 的超集——§8 披露字段在 draft 阶段可全部未知（null）。
 * 与 nodeOfferSchema 不同，本 schema 不带任何 default：文件格式全显式，
 * 缺键即校验失败（读边界绝不静默补全）。published 记录必须能通过 nodeOfferSchema
 * （发布/直写边界与 published 读取双重强制，见 application/node-offer-store.ts）。
 */
export const nodeOfferRecordSchema = nodeOfferSchema.extend({
  capability_id: opaqueIdSchema.nullable(),
  inputs: z.array(z.string().min(1)).nullable(),
  deliverables: z.array(z.string().min(1)).nullable(),
  availability: offerAvailabilitySchema.nullable(),
  geography: z.string().nullable(),
  language: z.string().nullable(),
  price_reward: moneySchema.nullable(),
  deadline: rfc3339TimestampSchema.nullable(),
  sla: z.string().nullable(),
  rights_constraints: z.array(z.string().min(1)).nullable(),
  acceptance_evaluator: offerAcceptanceEvaluatorSchema.nullable(),
  evidence_refs: z.array(z.string().min(1)).nullable(),
  delivery_history: z.array(z.string().min(1)).nullable(),
});
export type NodeOfferRecord = z.infer<typeof nodeOfferRecordSchema>;

/**
 * 发布补丁：出现的键逐字替换（含显式 null = 置回未知、空数组 = 显式"无"），
 * 缺席的键保持草稿原值；任何字段都不做默认。tenant/node_ref（要约身份）不可经补丁修改。
 */
export const offerPublishInputSchema = nodeOfferDraftInputSchema
  .omit({ tenant_id: true, node_ref: true })
  .partial();
export type OfferPublishInput = z.infer<typeof offerPublishInputSchema>;

/** §8 披露缺失字段名（权威清单 NODE_OFFER_REQUIRED_DISCLOSURES 的成员）。 */
export type MissingOfferDisclosure = (typeof NODE_OFFER_REQUIRED_DISCLOSURES)[number];

/** offer 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class NodeOfferNotFoundError extends Error {
  constructor(public readonly offerId: string) {
    super(`node offer not found: ${offerId}`);
    this.name = "NodeOfferNotFoundError";
  }
}

/** §8 披露不全，发布被门禁拒绝（fail-closed）：携带缺失字段的确切名单，绝无静默默认。 */
export class OfferPublishBlockedError extends Error {
  constructor(public readonly missingDisclosures: readonly MissingOfferDisclosure[]) {
    super(
      `§8 披露缺失，offer 只能停留在 draft（missing: ${missingDisclosures.join(", ")})`,
    );
    this.name = "OfferPublishBlockedError";
  }
}

/** 创建即 draft（生命周期词表：发布只能走 NodeOfferStore.publish 门禁）。 */
export const NODE_OFFER_STATUS_DRAFT = "draft" as const;
/** published（§8 全披露才可达；门禁 + invariants §14 双重守卫）。 */
export const NODE_OFFER_STATUS_PUBLISHED = "published" as const;
/** withdrawn（不再出现在 published 列表；可重新过门禁后再发布）。 */
export const NODE_OFFER_STATUS_WITHDRAWN = "withdrawn" as const;
