import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calibrationRecordSchema,
  ContractValidationError,
  parseOrFail,
  type CalibrationRecord,
} from "@mos/contracts";
import type { ExperimentLookup } from "../contract/calibration.js";
import {
  CalibrationSourceError,
  type CalibrationIntake,
  type CalibrationWriteDeps,
} from "../contract/calibration.js";
import {
  assertCalibrationSource,
  calibrationFromIntake,
} from "../domain/calibration.js";

const STORE_FILE_NAME = "mos-calibrations.json";
const STORE_SCHEMA_VERSION = 1;

/**
 * 校准记录存储（tenant-scoped、单 JSON 文件、原子写 tmp+rename；与 W2/W3 各 store 同约定）。
 *
 * 延迟模式安全位：record.delayed_mode 由共享 schema 层锁死为 true（z.literal(true)）；
 * 本类不提供任何修改 routes / production / 实验的 API——校准只是建议记录（不变量 §23）。
 * 跨租户记录对读取方不可见（tenant 过滤），调用方租户与记录租户不一致 → fail-closed。
 */
export class CalibrationStore {
  private readonly directory: string;
  private readonly experimentLookup: ExperimentLookup;

  constructor(options: { directory: string; experimentLookup: ExperimentLookup }) {
    this.directory = options.directory;
    this.experimentLookup = options.experimentLookup;
  }

  /** 写入校准记录（来源门禁 → 记录物化 → 持久化；失败不落盘）。 */
  record(
    tenantId: string,
    intake: CalibrationIntake,
    deps: CalibrationWriteDeps,
  ): CalibrationRecord {
    if (intake.tenant_id !== tenantId) {
      throw new ContractValidationError("CalibrationIntake", [
        `tenant 不一致：调用方 ${tenantId} / 记录 ${intake.tenant_id}`,
      ]);
    }
    assertCalibrationSource(this.experimentLookup, tenantId, intake.experiment_ref);
    const record = calibrationFromIntake(intake, deps);
    const all = [...this.readAll()];
    if (all.some((existing) => existing.id === record.id)) {
      throw new ContractValidationError("CalibrationRecord", [
        `id 已存在：${record.id}（校准记录不可覆盖；新校准用新 id）`,
      ]);
    }
    all.push(record);
    this.writeAll(all);
    return record;
  }

  listByTenant(tenantId: string): readonly CalibrationRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  listByExperiment(tenantId: string, experimentRef: string): readonly CalibrationRecord[] {
    return this.readAll().filter(
      (record) =>
        record.tenant_id === tenantId && record.experiment_ref === experimentRef,
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：文件缺失 → 空启动；JSON/结构/schema 损坏 fail-closed。 */
  private readAll(): readonly CalibrationRecord[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("CalibrationStore", [
        `存储文件不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("CalibrationStore", [
        "存储文件结构必须是 { version, calibrations }",
      ]);
    }
    const calibrations = (parsed as { calibrations?: unknown }).calibrations;
    if (!Array.isArray(calibrations)) {
      throw new ContractValidationError("CalibrationStore", [
        "存储文件缺少 calibrations 数组",
      ]);
    }
    return calibrations.map(
      (item) => parseOrFail("CalibrationRecord", calibrationRecordSchema, item) as CalibrationRecord,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename（与 W2/W3 store 同约定）。 */
  private writeAll(calibrations: readonly CalibrationRecord[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, calibrations }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}

export { CalibrationSourceError };
