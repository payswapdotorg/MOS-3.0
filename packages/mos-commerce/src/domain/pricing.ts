import {
  assertPriceRecordImmutable,
  assertTenantScope,
  parseOrFail,
  priceRecordSchema,
} from "@mos/contracts";
import type { PriceRecord, PriceStatus } from "@mos/contracts";
import { priceIntakeSchema } from "../contract/pricing.js";
import {
  PRICE_STATUS_ACTIVE,
  PRICE_STATUS_RETIRED,
  PriceTransitionError,
} from "../contract/pricing.js";
import type { PriceIntake } from "../contract/pricing.js";

/**
 * 定价领域（纯函数）：
 * - 创建恒为 active；替代/调价 = 追加新记录（§24 append-only —— 本包无 update API）；
 * - retirePrice 只改 status/superseded_by/updated_at，§24 终守卫 defense in depth；
 * - 同产品同模型 active 窗口重叠 = PriceConflictError（store 落盘前判定）。
 */

/** 写入输入 → PriceRecord（纯函数；创建恒为 active）。 */
export function priceFromInput(
  input: PriceIntake,
  deps: { id: string; now: string },
): PriceRecord {
  const normalized = parseOrFail("PriceIntake", priceIntakeSchema, input) as PriceIntake;

  const record: PriceRecord = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    product_id: normalized.product_id,
    price: { ...normalized.price },
    pricing_model: normalized.pricing_model,
    effective_from: normalized.effective_from,
    effective_until: normalized.effective_until,
    superseded_by: null,
    evidence_refs: [...normalized.evidence_refs],
    status: PRICE_STATUS_ACTIVE,
    created_at: deps.now,
    updated_at: deps.now,
  };
  assertTenantScope(record, { tenant_id: normalized.tenant_id }, "price record");
  return parseOrFail("PriceRecord", priceRecordSchema, record) as PriceRecord;
}

/** 两个生效窗口是否重叠（open-ended until = 无限延伸）。 */
export function priceWindowsOverlap(
  a: { effective_from: string; effective_until: string | null },
  b: { effective_from: string; effective_until: string | null },
): boolean {
  const aEnd = a.effective_until ?? "9999-12-31T23:59:59.999Z";
  const bEnd = b.effective_until ?? "9999-12-31T23:59:59.999Z";
  return a.effective_from < bEnd && b.effective_from < aEnd;
}

/** 新价格是否与既有 active 价格冲突（同产品 + 同模型 + 窗口重叠）。 */
export function findConflictingActivePrice(
  candidate: PriceRecord,
  existing: readonly PriceRecord[],
): PriceRecord | null {
  const conflict = existing.find(
    (record) =>
      record.status === PRICE_STATUS_ACTIVE &&
      record.tenant_id === candidate.tenant_id &&
      record.product_id === candidate.product_id &&
      record.pricing_model === candidate.pricing_model &&
      record.id !== candidate.id &&
      priceWindowsOverlap(
        {
          effective_from: record.effective_from,
          effective_until: record.effective_until,
        },
        {
          effective_from: candidate.effective_from,
          effective_until: candidate.effective_until,
        },
      ),
  );
  return conflict ?? null;
}

/** active → retired + superseded_by 指向新记录（append-only 历史的指针，不改写旧价）。 */
export function retirePrice(
  record: PriceRecord,
  supersededBy: string,
  deps: { now: string },
): PriceRecord {
  if (record.status !== PRICE_STATUS_ACTIVE) {
    throw new PriceTransitionError(record.status, PRICE_STATUS_RETIRED);
  }
  const next: PriceRecord = {
    ...record,
    status: PRICE_STATUS_RETIRED,
    superseded_by: supersededBy,
    updated_at: deps.now,
  };
  // 不变量 §24 终守卫（defense in depth：store 落盘前还会对每条记录再跑一次）。
  assertPriceRecordImmutable(record, next);
  return parseOrFail("PriceRecord", priceRecordSchema, next) as PriceRecord;
}

/** 通用转移（当前只有 retired 目标；未知目标由转移表拒绝）。 */
export function applyPriceTransition(
  record: PriceRecord,
  target: PriceStatus,
  deps: { now: string },
): PriceRecord {
  if (target !== PRICE_STATUS_RETIRED) {
    throw new PriceTransitionError(record.status, target);
  }
  return retirePrice(record, record.superseded_by ?? record.id, deps);
}
