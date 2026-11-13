import {
  assertMarketIntelligenceEvidenced,
  assertTenantScope,
  marketIntelligenceRecordSchema,
  parseOrFail,
} from "@mos/contracts";
import type { MarketIntelligenceRecord } from "@mos/contracts";
import { marketIntelligenceIntakeSchema } from "../contract/market-intelligence.js";
import type { MarketIntelligenceIntake } from "../contract/market-intelligence.js";

/**
 * 情报领域（纯函数）：写入输入 → MarketIntelligenceRecord。
 * §25 证据门禁双层：intake schema min(1) fail-closed + 领域终守卫（defense in depth）。
 * facts 原样承载（零推断）；subject_ref 不透明（记录内零 PII）。
 */
export function marketIntelligenceFromInput(
  input: MarketIntelligenceIntake,
  deps: { id: string; now: string },
): MarketIntelligenceRecord {
  const normalized = parseOrFail(
    "MarketIntelligenceIntake",
    marketIntelligenceIntakeSchema,
    input,
  ) as MarketIntelligenceIntake;

  const record: MarketIntelligenceRecord = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    topic: normalized.topic,
    subject_ref: normalized.subject_ref,
    facts: { ...normalized.facts },
    evidence_refs: [...normalized.evidence_refs],
    insight: normalized.insight,
    confidence: normalized.confidence,
    limitations: [...normalized.limitations],
    observed_at: normalized.observed_at,
    created_at: deps.now,
    updated_at: deps.now,
  };
  assertTenantScope(record, { tenant_id: normalized.tenant_id }, "market intelligence");
  // 不变量 §25 终守卫（defense in depth：store 落盘前还会对每条记录再跑一次）。
  assertMarketIntelligenceEvidenced(record);
  return parseOrFail(
    "MarketIntelligenceRecord",
    marketIntelligenceRecordSchema,
    record,
  ) as MarketIntelligenceRecord;
}
