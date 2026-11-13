import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertMarketIntelligenceEvidenced,
  assertTenantScope,
  ContractValidationError,
  marketIntelligenceRecordSchema,
  parseOrFail,
} from "@mos/contracts";
import type { MarketIntelligenceRecord } from "@mos/contracts";
import { marketIntelligenceIntakeSchema } from "../contract/market-intelligence.js";
import { MarketIntelligenceValidationError } from "../contract/market-intelligence.js";
import type { MarketIntelligenceIntake } from "../contract/market-intelligence.js";
import { marketIntelligenceFromInput } from "../domain/market-intelligence.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-commerce-intelligence.json";
const STORE_SCHEMA_VERSION = 1;

export interface MarketIntelligenceStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped MarketIntelligenceRecord 存储（§25 证据门禁双层）。
 * - intake schema evidence_refs min(1) + 落盘前 §25 终守卫（defense in depth）。
 * - subject_ref 不透明（记录内零 PII）；facts 原样承载（零推断）。
 */
export class MarketIntelligenceStore {
  private readonly directory: string;

  constructor(options: MarketIntelligenceStoreOptions) {
    this.directory = options.directory;
  }

  /** 追加一条情报记录（无证据 → fail-closed）。 */
  createRecord(
    tenantId: string,
    input: MarketIntelligenceIntake,
    deps: { id: string; now: string },
  ): MarketIntelligenceRecord {
    let normalized: MarketIntelligenceIntake;
    try {
      normalized = parseOrFail(
        "MarketIntelligenceIntake",
        marketIntelligenceIntakeSchema,
        input,
      ) as MarketIntelligenceIntake;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new MarketIntelligenceValidationError(error.issues);
      }
      throw error;
    }
    const record = marketIntelligenceFromInput(normalized, deps);
    assertTenantScope(record, { tenant_id: tenantId }, "market intelligence");
    const all = this.readAll();
    this.persist(all, record);
    return record;
  }

  getRecord(tenantId: string, recordId: string): MarketIntelligenceRecord | null {
    const found = this.readAll().find((record) => record.id === recordId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "market intelligence");
    return found;
  }

  /** 列出调用方租户的全部情报记录（其他租户的记录不可见）。 */
  listRecordsByTenant(tenantId: string): readonly MarketIntelligenceRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 列出某不透明 subject（客户/细分市场/区域）的情报记录。 */
  listRecordsBySubject(tenantId: string, subjectRef: string): readonly MarketIntelligenceRecord[] {
    return this.readAll().filter(
      (record) => record.tenant_id === tenantId && record.subject_ref === subjectRef,
    );
  }

  /** 落盘前统一守卫：schema + 不变量 §25（defense in depth）。 */
  private persist(
    all: readonly MarketIntelligenceRecord[],
    record: MarketIntelligenceRecord,
  ): void {
    const validated = parseOrFail(
      "MarketIntelligenceRecord",
      marketIntelligenceRecordSchema,
      record,
    ) as MarketIntelligenceRecord;
    assertMarketIntelligenceEvidenced(validated);
    const existing = all.find(
      (candidate) =>
        candidate.tenant_id === validated.tenant_id && candidate.id === validated.id,
    );
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
  private readAll(): readonly MarketIntelligenceRecord[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("MarketIntelligenceStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("MarketIntelligenceStore", [
        "存储文件结构必须是 { version, market_intelligence }",
      ]);
    }
    const records = (parsed as { market_intelligence?: unknown }).market_intelligence;
    if (!Array.isArray(records)) {
      throw new ContractValidationError("MarketIntelligenceStore", [
        "存储文件缺少 market_intelligence 数组",
      ]);
    }
    return records.map(
      (record) =>
        parseOrFail(
          "MarketIntelligenceRecord",
          marketIntelligenceRecordSchema,
          record,
        ) as MarketIntelligenceRecord,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(records: readonly MarketIntelligenceRecord[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, market_intelligence: records }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
