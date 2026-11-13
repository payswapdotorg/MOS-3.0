import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertTenantScope,
  ContractValidationError,
  parseOrFail,
} from "@mos/contracts";
import type { RightsRecord } from "@mos/contracts";
import {
  RightsRecordNotFoundError,
  RightsValidationError,
  rightsRecordInputSchema,
  rightsRecordRecordSchema,
} from "../contract/rights.js";
import type { RightsRecordInput } from "../contract/rights.js";
import type { RightsRecordDeps } from "../contract.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-rights-records.json";
const STORE_SCHEMA_VERSION = 1;

export interface RightsRecordStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped RightsRecord 存储（authority: rights-policy；W2 store 同构）。
 *
 * - 文件后端：注入目录下单文件 mos-rights-records.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/记录损坏 fail-closed
 *   抛 ContractValidationError（记录 schema 无默认值，读边界绝不静默补全）。
 * - 写边界（saveRecord，upsert by id）：
 *   - 输入经 rightsRecordInputSchema（kind 限可写词表；失败 → 类型化
 *     RightsValidationError）；
 *   - review_decision 追加式（append-only）：已存在记录（同 id）为 review_decision 时，
 *     decision 不可改、kind 不可改（防止把评审记录洗成其他 kind 来改决定）——
 *     改变决定必须以新 id 追加新记录；违例 → RightsValidationError；
 *   - 非 review_decision 记录自由 upsert（constraints / 到期时间等可演化）；
 *   - created_at 在 upsert 时保持首写值，updated_at 以注入 now 推进。
 * - tenant 边界：saveRecord 遇同 id 他租户记录、getRecord 命中他租户记录 →
 *   assertTenantScope InvariantViolation（跨租户访问绝不当作"不存在"处理）；
 *   listByTenant / listForArtifact 只返回调用方租户的记录。
 * - listForArtifact：subject_artifact_ref 精确匹配 artifactRef 或 null 通配
 *   （通配记录覆盖全部 artifact），tenant 内过滤——供 RightsGateService 评估。
 */
export class RightsRecordStore {
  private readonly directory: string;

  constructor(options: RightsRecordStoreOptions) {
    this.directory = options.directory;
  }

  /**
   * 保存（upsert by id）一条权利记录：review_decision 追加式（decision/kind 不可改），
   * 其余 kind 自由 upsert；跨租户同 id 写入 fail-closed。
   */
  saveRecord(
    tenantId: string,
    input: RightsRecordInput,
    deps: RightsRecordDeps,
  ): RightsRecord {
    const normalized = this.parseInput(input);

    const all = this.readAll();
    const existing = all.find((record) => record.id === deps.id);
    if (existing !== undefined) {
      // 同 id 记录存在：他租户 → 跨租户写入 fail-closed；本租户 → 追加式守卫。
      assertTenantScope(existing, { tenant_id: tenantId }, "RightsRecord");
      this.assertReviewDecisionAppendOnly(existing, normalized);
    }

    const candidate: RightsRecord = {
      id: deps.id,
      tenant_id: tenantId,
      kind: normalized.kind,
      subject_ref: normalized.subject_ref,
      subject_artifact_ref: normalized.subject_artifact_ref,
      constraints: [...normalized.constraints],
      evidence_refs: [...normalized.evidence_refs],
      decision: normalized.decision,
      decided_at: normalized.decided_at,
      expires_at: normalized.expires_at,
      created_at: existing !== undefined ? existing.created_at : deps.now,
      updated_at: deps.now,
    };

    const persisted = parseOrFail(
      "RightsRecordRecord",
      rightsRecordRecordSchema,
      candidate,
    ) as RightsRecord;

    this.writeAll(
      existing === undefined
        ? [...all, persisted]
        : all.map((record) => (record === existing ? persisted : record)),
    );
    return persisted;
  }

  /** 读取单条权利记录；id 不存在抛 RightsRecordNotFoundError，跨租户读取 fail-closed。 */
  getRecord(tenantId: string, recordId: string): RightsRecord {
    const found = this.readAll().find((record) => record.id === recordId);
    if (found === undefined) {
      throw new RightsRecordNotFoundError(recordId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "RightsRecord");
    return found;
  }

  /** 列出该租户的全部权利记录（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly RightsRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /**
   * 列出该租户内与 artifactRef 相关的权利记录：
   * subject_artifact_ref 精确匹配（专属覆盖）或 null（通配覆盖）。
   */
  listForArtifact(tenantId: string, artifactRef: string): readonly RightsRecord[] {
    return this.readAll().filter(
      (record) =>
        record.tenant_id === tenantId &&
        (record.subject_artifact_ref === artifactRef || record.subject_artifact_ref === null),
    );
  }

  /**
   * review_decision 追加式守卫（append-only，fail-closed）：
   * - decision 不可改（改变决定必须追加新 id 的新记录）；
   * - kind 不可改（防止把已存在的 review_decision 洗成其他 kind 绕过上一条）。
   */
  private assertReviewDecisionAppendOnly(
    existing: RightsRecord,
    next: RightsRecordInput,
  ): void {
    if (existing.kind !== "review_decision") return;
    if (next.kind !== "review_decision") {
      throw new RightsValidationError([
        `review_decision 追加式：记录 ${existing.id} 的 kind 不可从 review_decision 改为 ${next.kind}（改变决定必须追加新 id）`,
      ]);
    }
    if (next.decision !== existing.decision) {
      throw new RightsValidationError([
        `review_decision 追加式：记录 ${existing.id} 的 decision 不可从 ${existing.decision} 改为 ${next.decision}（改变决定必须追加新 id）`,
      ]);
    }
  }

  /** 写边界校验：schema 失败投影为类型化 RightsValidationError（fail-closed）。 */
  private parseInput(input: RightsRecordInput): RightsRecordInput {
    try {
      return parseOrFail(
        "RightsRecordInput",
        rightsRecordInputSchema,
        input,
      ) as RightsRecordInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new RightsValidationError(error.issues);
      }
      throw error;
    }
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly RightsRecord[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("RightsRecordStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("RightsRecordStore", [
        "存储文件结构必须是 { version, rights_records }",
      ]);
    }
    const records = (parsed as { rights_records?: unknown }).rights_records;
    if (!Array.isArray(records)) {
      throw new ContractValidationError("RightsRecordStore", [
        "存储文件缺少 rights_records 数组",
      ]);
    }
    return records.map(
      (record) =>
        parseOrFail("RightsRecordRecord", rightsRecordRecordSchema, record) as RightsRecord,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(records: readonly RightsRecord[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, rights_records: records }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
