import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertResearchFindingEvidence,
  assertTenantScope,
  ContractValidationError,
  parseOrFail,
  researchNoteSchema,
} from "@mos/contracts";
import type { ResearchNote } from "@mos/contracts";
import type { EvidenceLookup } from "../contract/research.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-research-notes.json";
const STORE_SCHEMA_VERSION = 1;

export interface ResearchNoteStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /**
   * Evidence 查找端口（结构化注入，无 provider I/O）：写边界对每条 finding
   * 调用 assertResearchFindingEvidence——引用不存在的 evidence、或 simulation
   * 证据充当 provider 观测（不变量 §16）都 fail-closed，整条 note 不落盘。
   * tenant 范围约束由注入方（组合根）承担。
   */
  readonly evidenceLookup: EvidenceLookup;
}

/**
 * 持久 tenant-scoped ResearchNote 存储（与 W1 mos-missions mission-store 同模式）。
 *
 * - 文件后端：注入目录下单文件 mos-research-notes.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）。
 * - 写边界：researchNoteSchema + assertTenantScope + 逐条 finding 的
 *   assertResearchFindingEvidence（经 evidenceLookup 端口，不变量 §16）。
 * - tenant 边界（按工作包约定，区别于 mos-missions 的不可见语义——显式拒绝）：
 *   saveNote 遇 tenant 不一致、getNote 命中他租户记录 → assertTenantScope
 *   InvariantViolation（fail-closed）；未命中任何记录的 id → null；
 *   listNotes / listNotesByMission 只返回调用方租户的记录。
 * - 读取按 zod 默认策略容忍未知键（additive 演化），JSON/结构损坏 fail-closed 抛错。
 * - mission_id 是可空引用，本存储不校验其存在性（端口集按工作包仅含 evidenceLookup，
 *   见 CONTRACT.md「已知限制」）。
 */
export class ResearchNoteStore {
  private readonly directory: string;
  private readonly evidenceLookup: EvidenceLookup;

  constructor(options: ResearchNoteStoreOptions) {
    this.directory = options.directory;
    this.evidenceLookup = options.evidenceLookup;
  }

  /** 保存（upsert）一条 ResearchNote；每条 finding 的 evidence 必须存在且非 simulation。 */
  saveNote(tenantId: string, note: ResearchNote): ResearchNote {
    const validated = parseOrFail("ResearchNote", researchNoteSchema, note) as ResearchNote;
    assertTenantScope(validated, { tenant_id: tenantId }, "research note");
    // 不变量 §16：逐条 finding 的 evidence 存在性 + 非 simulation 判定（fail-closed）。
    for (const finding of validated.findings) {
      assertResearchFindingEvidence(finding, this.evidenceLookup(finding.evidence_ref));
    }

    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === tenantId && record.id === validated.id,
    );
    this.writeAll(
      existing === undefined
        ? [...all, validated]
        : all.map((record) => (record === existing ? validated : record)),
    );
    return validated;
  }

  /**
   * 读取单条 ResearchNote：id 未命中任何记录 → null；
   * 命中他租户记录 → assertTenantScope InvariantViolation（跨租户访问显式拒绝）。
   */
  getNote(tenantId: string, noteId: string): ResearchNote | null {
    const found = this.readAll().find((record) => record.id === noteId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "research note");
    return found;
  }

  /** 列出调用方租户的全部 ResearchNote。 */
  listNotes(tenantId: string): readonly ResearchNote[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 列出调用方租户内挂在指定 mission 下的笔记（mission_id 为 null 的笔记永不匹配）。 */
  listNotesByMission(tenantId: string, missionId: string): readonly ResearchNote[] {
    return this.readAll().filter(
      (record) => record.tenant_id === tenantId && record.mission_id === missionId,
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly ResearchNote[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("ResearchNoteStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("ResearchNoteStore", [
        "存储文件结构必须是 { version, notes }",
      ]);
    }
    const notes = (parsed as { notes?: unknown }).notes;
    if (!Array.isArray(notes)) {
      throw new ContractValidationError("ResearchNoteStore", [
        "存储文件缺少 notes 数组",
      ]);
    }
    return notes.map(
      (record) => parseOrFail("ResearchNote", researchNoteSchema, record) as ResearchNote,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(notes: readonly ResearchNote[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, notes }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
