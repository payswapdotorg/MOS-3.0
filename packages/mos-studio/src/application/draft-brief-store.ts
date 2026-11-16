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
import {
  draftBriefRecordSchema,
  type DraftBriefRecord,
} from "../contract/draft-brief.js";
import { DRAFT_BRIEF_STORE_FILENAME } from "../contract/studio-vocabulary.js";

/**
 * 持久 tenant-scoped Studio 草稿简报存储（$ZCODE_PLUGIN_DATA/mos-briefs.json，原子写）。
 *
 * - 记录只承载引用与逐字输入；artifact 版本链/状态由 mos-content-artifacts 持有，
 *   复核决定由 mos-rights-policy 持有（组合根展示时 join，双权威不镜像）。
 * - 读写边界：所有方法以调用方 tenant_id 为准；他租户记录不可见。
 * - 校验：写入前 draftBriefRecordSchema；读取结构损坏 fail-closed。
 */
export class DraftBriefStore {
  private readonly filePath: string;

  constructor(options: { directory: string }) {
    this.filePath = join(options.directory, DRAFT_BRIEF_STORE_FILENAME);
  }

  saveBrief(tenantId: string, record: DraftBriefRecord): DraftBriefRecord {
    if (record.tenant_id !== tenantId) {
      throw new ContractValidationError("DraftBriefRecord", [
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

  getBrief(tenantId: string, briefId: string): DraftBriefRecord | null {
    const found = this.readAll().find(
      (record) => record.tenant_id === tenantId && record.id === briefId,
    );
    return found ?? null;
  }

  listBriefs(tenantId: string): readonly DraftBriefRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  listBriefsByMission(tenantId: string, missionId: string): readonly DraftBriefRecord[] {
    return this.listBriefs(tenantId).filter((record) => record.mission_id === missionId);
  }

  private readAll(): readonly DraftBriefRecord[] {
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
      throw new ContractValidationError("DraftBriefStore", [
        `简报存储损坏（JSON 不可解析）: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if (!Array.isArray(parsed)) {
      throw new ContractValidationError("DraftBriefStore", ["简报存储损坏（顶层不是数组）"]);
    }
    return parsed.map((entry) => {
      const result = draftBriefRecordSchema.safeParse(entry);
      if (!result.success) {
        throw new ContractValidationError("DraftBriefRecord", [
          `简报记录形状不合法: ${result.error.message}`,
        ]);
      }
      return result.data;
    });
  }

  private writeAll(records: readonly DraftBriefRecord[]): void {
    mkdirSync(join(this.filePath, ".."), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }
}
