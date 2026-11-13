import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OPERATOR_STORE_FILENAME,
} from "../contract/studio-vocabulary.js";
import {
  operatorRecordSchema,
  type OperatorRecord,
} from "../contract/operator.js";

/**
 * 操作者声明存储（$ZCODE_PLUGIN_DATA/mos-operator.json，原子写）。
 * 与 MissionStore/ConnectionStore 同目录；tenant 无关（单机单操作者声明），
 * 但只保存声明事实（declaredAt），绝不冒充 ZCode 账户事实。
 */
export class OperatorStore {
  private readonly filePath: string;

  constructor(options: { directory: string }) {
    this.filePath = join(options.directory, OPERATOR_STORE_FILENAME);
  }

  async save(input: { userId: string; organizationId: string | null; declaredAt: string }): Promise<OperatorRecord> {
    const record = operatorRecordSchema.parse({
      userId: input.userId,
      organizationId: input.organizationId,
      declaredAt: input.declaredAt,
    });
    await this.writeAtomic(`${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  async load(): Promise<OperatorRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = operatorRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      // 损坏文件 fail-closed（不部分解析、不发明操作者）
      return null;
    }
  }

  private async writeAtomic(text: string): Promise<void> {
    const temporary = join(dirname(this.filePath), `.${randomUUID()}.tmp`);
    await writeFile(temporary, text, "utf8");
    await rename(temporary, this.filePath);
  }
}
