import type { NodeOfferRecord, MissingOfferDisclosure } from "../contract/node-offer.js";

/**
 * §8 披露门禁（纯函数，语义与 @mos/contracts 的 NODE_OFFER_REQUIRED_DISCLOSURES
 * 及 assertNodeOfferPublishable 保持一致；返回值即 OfferPublishBlockedError 携带的名单）。
 *
 * 字段级判定规则：
 * - null → 缺失（未知保持未知，绝不猜测）；
 * - deliverables / evidence_refs：空数组也算缺失（要约必须有交付物与证据引用）；
 * - rights_constraints / delivery_history：显式空数组 = 披露"无"，不算缺失；null 算缺失；
 * - availability：整体 null，或 windows 与 capacity 同时 null → 缺失
 *   （只披露其一即视为已披露可用性）；
 * - capability_id / acceptance_evaluator.evaluator_ref：纯空白视为缺失
 *   （schema 只拦空串，这里防御空白串，与 assertNodeOfferPublishable 同源）；
 * - inputs 不在 NODE_OFFER_REQUIRED_DISCLOSURES 清单内，门禁不点名它；
 *   但 published 记录必须符合 nodeOfferSchema（inputs 为非空类型数组），
 *   publish 物化时 fail-closed（ContractValidationError），绝不静默默认。
 *
 * 永不变异输入；返回字段名按 NODE_OFFER_REQUIRED_DISCLOSURES 顺序排列（确定性）。
 */
export function missingOfferDisclosures(
  record: NodeOfferRecord,
): readonly MissingOfferDisclosure[] {
  const missing: MissingOfferDisclosure[] = [];
  if (record.capability_id === null || record.capability_id.trim().length === 0) {
    missing.push("capability_id");
  }
  if (record.deliverables === null || record.deliverables.length === 0) {
    missing.push("deliverables");
  }
  if (
    record.availability === null ||
    (record.availability.windows === null && record.availability.capacity === null)
  ) {
    missing.push("availability");
  }
  if (record.geography === null) {
    missing.push("geography");
  }
  if (record.language === null) {
    missing.push("language");
  }
  if (record.price_reward === null) {
    missing.push("price_reward");
  }
  if (record.deadline === null) {
    missing.push("deadline");
  }
  if (record.sla === null) {
    missing.push("sla");
  }
  if (record.rights_constraints === null) {
    missing.push("rights_constraints");
  }
  if (
    record.acceptance_evaluator === null ||
    record.acceptance_evaluator.evaluator_ref.trim().length === 0
  ) {
    missing.push("acceptance_evaluator");
  }
  if (record.evidence_refs === null || record.evidence_refs.length === 0) {
    missing.push("evidence_refs");
  }
  if (record.delivery_history === null) {
    missing.push("delivery_history");
  }
  return missing;
}
