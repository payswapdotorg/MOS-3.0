import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertPriceRecordImmutable,
  assertTenantScope,
  ContractValidationError,
  parseOrFail,
  priceRecordSchema,
} from "@mos/contracts";
import type { PriceRecord } from "@mos/contracts";
import { priceIntakeSchema } from "../contract/pricing.js";
import {
  PriceConflictError,
  PriceNotFoundError,
  PriceValidationError,
} from "../contract/pricing.js";
import type { PriceIntake } from "../contract/pricing.js";
import { findConflictingActivePrice, priceFromInput, retirePrice } from "../domain/pricing.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-commerce-prices.json";
const STORE_SCHEMA_VERSION = 1;

export interface PriceStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped PriceRecord 存储（append-only 定价历史，§24）。
 * - 唯一改写路径是 retirePrice（status/superseded_by/updated_at）；
 *   金额/模型/生效窗口零更新 API —— 调价 = 追加新记录。
 * - 落盘前对被替换记录跑 §24 终守卫（hand-built 改写也会被拒）。
 * - 同产品同模型 active 窗口重叠 → PriceConflictError（fail-closed）。
 */
export class PriceStore {
  private readonly directory: string;

  constructor(options: PriceStoreOptions) {
    this.directory = options.directory;
  }

  /** 追加一条定价（创建恒为 active；重叠 active 窗口 → PriceConflictError）。 */
  createPrice(tenantId: string, input: PriceIntake, deps: { id: string; now: string }): PriceRecord {
    let normalized: PriceIntake;
    try {
      normalized = parseOrFail("PriceIntake", priceIntakeSchema, input) as PriceIntake;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new PriceValidationError(error.issues);
      }
      throw error;
    }
    const record = priceFromInput(normalized, deps);
    assertTenantScope(record, { tenant_id: tenantId }, "price record");
    const all = this.readAll();
    const conflict = findConflictingActivePrice(record, all);
    if (conflict !== null) {
      throw new PriceConflictError(record.product_id, record.pricing_model, conflict.id);
    }
    this.persist(all, record);
    return record;
  }

  getPrice(tenantId: string, priceId: string): PriceRecord | null {
    const found = this.readAll().find((record) => record.id === priceId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "price record");
    return found;
  }

  /** 列出调用方租户的全部定价历史（append-only，含 retired）。 */
  listPricesByTenant(tenantId: string): readonly PriceRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 列出某产品的定价历史（其他租户的记录不可见）。 */
  listPricesByProduct(tenantId: string, productId: string): readonly PriceRecord[] {
    return this.readAll().filter(
      (record) => record.tenant_id === tenantId && record.product_id === productId,
    );
  }

  /** active → retired + superseded_by 指针（唯一改写路径；§24 守卫 defense in depth）。 */
  retirePrice(
    tenantId: string,
    priceId: string,
    supersededBy: string,
    deps: { now: string },
  ): PriceRecord {
    const all = this.readAll();
    const current = this.findPrice(all, tenantId, priceId);
    const next = retirePrice(current, supersededBy, deps);
    this.persist(all, next);
    return next;
  }

  private findPrice(
    all: readonly PriceRecord[],
    tenantId: string,
    priceId: string,
  ): PriceRecord {
    const found = all.find((record) => record.id === priceId);
    if (found === undefined) {
      throw new PriceNotFoundError(tenantId, priceId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "price record");
    return found;
  }

  /** 落盘前统一守卫：schema + §24（被替换记录不可变字段零改动，defense in depth）。 */
  private persist(all: readonly PriceRecord[], record: PriceRecord): void {
    const validated = parseOrFail("PriceRecord", priceRecordSchema, record) as PriceRecord;
    const existing = all.find(
      (candidate) =>
        candidate.tenant_id === validated.tenant_id && candidate.id === validated.id,
    );
    if (existing !== undefined) {
      assertPriceRecordImmutable(existing, validated);
    }
    this.writeAll(
      existing === undefined
        ? [...all, validated]
        : all.map((candidate) => (candidate === existing ? validated : candidate)),
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly PriceRecord[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("PriceStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("PriceStore", [
        "存储文件结构必须是 { version, prices }",
      ]);
    }
    const prices = (parsed as { prices?: unknown }).prices;
    if (!Array.isArray(prices)) {
      throw new ContractValidationError("PriceStore", ["存储文件缺少 prices 数组"]);
    }
    return prices.map(
      (record) => parseOrFail("PriceRecord", priceRecordSchema, record) as PriceRecord,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(prices: readonly PriceRecord[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, prices }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
