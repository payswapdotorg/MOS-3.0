import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ContractValidationError } from "@mos/contracts";
import { evidenceRecordSchema, type EvidenceRecord } from "../contract/evidence.js";
import { EVIDENCE_STORE_FILENAME } from "../contract/studio-vocabulary.js";

/**
 * 持久 tenant-scoped 证据存储（$ZCODE_PLUGIN_DATA/mos-evidence.json，原子写）。
 *
 * - 写入只来自 executeAuthorizedRead 的成功分支（真实 provider 读；组合根是唯一
 *   写 authority，其它模块经 EvidenceLookup 端口按已解析租户视图读取）。
 * - 读写边界：所有方法以调用方 tenant_id 为准；他租户记录不可见（get 未命中他租户
 *   同 id 记录按不存在处理——证据 id 全局唯一（uuid），跨租户碰撞不是可达状态）。
 * - 校验：写入前 evidenceRecordSchema；读取结构损坏 fail-closed 抛
 *   ContractValidationError（不部分解析、不发明证据）。
 */
export class EvidenceStore {
  private readonly filePath: string;

  constructor(options: { directory: string }) {
    this.filePath = join(options.directory, EVIDENCE_STORE_FILENAME);
  }

  saveEvidence(tenantId: string, record: EvidenceRecord): EvidenceRecord {
    if (record.tenant_id !== tenantId) {
      throw new ContractValidationError("EvidenceRecord", [
        `tenant 越界: record.tenant_id=${record.tenant_id} 与调用方 tenant=${tenantId} 不一致`,
      ]);
    }
    const all = this.readAll();
    const next = all.filter(
      (existing) => !(existing.tenant_id === tenantId && existing.id === record.id),
    );
    this.writeAll([...next, record]);
    return record;
  }

  getEvidence(tenantId: string, evidenceId: string): EvidenceRecord | null {
    const found = this.readAll().find(
      (record) => record.tenant_id === tenantId && record.id === evidenceId,
    );
    return found ?? null;
  }

  listEvidence(tenantId: string): readonly EvidenceRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  listEvidenceByMission(tenantId: string, missionId: string): readonly EvidenceRecord[] {
    return this.listEvidence(tenantId).filter((record) => record.mission_id === missionId);
  }

  private readAll(): readonly EvidenceRecord[] {
    if (!existsSync(this.filePath)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ContractValidationError("EvidenceStore", [
        `证据存储损坏（JSON 不可解析）: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if (!Array.isArray(parsed)) {
      throw new ContractValidationError("EvidenceStore", ["证据存储损坏（顶层不是数组）"]);
    }
    return parsed.map((entry) => {
      const result = evidenceRecordSchema.safeParse(entry);
      if (!result.success) {
        throw new ContractValidationError("EvidenceRecord", [
          `证据记录形状不合法: ${result.error.message}`,
        ]);
      }
      return result.data;
    });
  }

  private writeAll(records: readonly EvidenceRecord[]): void {
    mkdirSync(join(this.filePath, ".."), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }
}
