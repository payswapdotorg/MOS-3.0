import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertDistributionPreviewApproval,
  assertTenantScope,
  ContractValidationError,
  distributionIntentSchema,
  parseOrFail,
} from "@mos/contracts";
import type { DistributionIntent, DistributionStatus } from "@mos/contracts";
import {
  distributionIntentInputSchema,
  IdempotencyConflictError,
  IntentNotFoundError,
  IntentValidationError,
  previewBindingSchema,
} from "../contract/intent.js";
import type {
  DistributionIntentInput,
  PreviewBinding,
} from "../contract/intent.js";
import {
  applyIntentTransition,
  bindPreview,
  intentFromInput,
  recordExecution,
} from "../domain/intent-transitions.js";
import type {
  IntentCreationDeps,
  IntentTransitionDeps,
} from "../contract.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-distribution-intents.json";
const STORE_SCHEMA_VERSION = 1;

export interface DistributionIntentStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped DistributionIntent 存储（与 W1 mission-store / W2 lab store 同模式）。
 *
 * - 文件后端：注入目录下单文件 mos-distribution-intents.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；读取容忍未知键（additive），
 *   JSON/结构损坏 fail-closed 抛 ContractValidationError。
 * - 决策锁 #8：本存储零 provider I/O —— execution_records 只保存不透明 evidence 引用；
 *   真正的 provider 发布/更新/删除由 Integration adapters 在组合根（W1 缝）执行，
 *   执行结果以 evidence 引用回填（recordExecution）。
 * - 写边界（不变量 §22）：createIntent / bindPreview / applyTransition / recordExecution
 *   全部经 domain 状态机；每条落盘记录再跑一次 assertDistributionPreviewApproval
 *   （executing/succeeded 未绑定已批准预览的记录不可能经任何写路径落盘）。
 * - 幂等键：idempotency_key 提供时按 (tenant, key) 唯一；重复（含同 id 重试）→
 *   IdempotencyConflictError（具名冲突记录），绝不静默重复创建。
 * - tenant 边界：createIntent 遇输入 tenant 与调用方不一致、get/applyTransition/
 *   bindPreview/recordExecution 命中他租户记录 → assertTenantScope InvariantViolation；
 *   未命中任何记录的 id → IntentNotFoundError（get 未命中 → null）；listByTenant 只返回
 *   调用方租户的记录。
 */
export class DistributionIntentStore {
  private readonly directory: string;

  constructor(options: DistributionIntentStoreOptions) {
    this.directory = options.directory;
  }

  /**
   * 创建意图（status=intent；idempotency_key 可选但提供时按租户唯一）。
   * 输入 shape 失败 → IntentValidationError；输入 tenant 与调用方不一致 → InvariantViolation。
   */
  createIntent(
    tenantId: string,
    input: DistributionIntentInput,
    deps: IntentCreationDeps,
  ): DistributionIntent {
    const normalized = this.parseInput(input);
    const record = intentFromInput(normalized, deps);
    assertTenantScope(record, { tenant_id: tenantId }, "distribution intent");

    const all = this.readAll();
    if (record.idempotency_key !== null) {
      const clash = all.find(
        (existing) =>
          existing.tenant_id === tenantId &&
          existing.idempotency_key === record.idempotency_key,
      );
      if (clash !== undefined) {
        throw new IdempotencyConflictError(
          tenantId,
          record.idempotency_key,
          clash.id,
        );
      }
    }
    this.persist(all, record);
    return record;
  }

  /**
   * 读取单条意图：id 未命中任何记录 → null；
   * 命中他租户记录 → assertTenantScope InvariantViolation（跨租户访问显式拒绝）。
   */
  getIntent(tenantId: string, intentId: string): DistributionIntent | null {
    const found = this.readAll().find((record) => record.id === intentId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "distribution intent");
    return found;
  }

  /** 列出调用方租户的全部意图（其他租户的记录不可见）。 */
  listIntentsByTenant(tenantId: string): readonly DistributionIntent[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 绑定 ExternalActionPreview（domain：只在 status=intent 时可绑定 → previewed）。 */
  bindPreview(
    tenantId: string,
    intentId: string,
    binding: PreviewBinding,
    deps: IntentTransitionDeps,
  ): DistributionIntent {
    const all = this.readAll();
    const current = this.findIntent(all, tenantId, intentId);
    const normalized = parseOrFail(
      "PreviewBinding",
      previewBindingSchema,
      binding,
    ) as PreviewBinding;
    const next = bindPreview(current, normalized, deps);
    this.persist(all, next);
    return next;
  }

  /**
   * 状态机转移（domain 机器 + 边级门禁；approved→executing 边由
   * assertDistributionPreviewApproval 终守卫，见 domain/intent-transitions.ts）。
   */
  applyTransition(
    tenantId: string,
    intentId: string,
    target: DistributionStatus,
    deps: IntentTransitionDeps,
  ): DistributionIntent {
    const all = this.readAll();
    const current = this.findIntent(all, tenantId, intentId);
    const next = applyIntentTransition(current, target, deps);
    this.persist(all, next);
    return next;
  }

  /**
   * 追加执行证据引用（append-only；provider 执行本身归 Integration adapters，
   * 此处只记录不透明 evidence 引用 —— evidence refs ONLY）。
   */
  recordExecution(
    tenantId: string,
    intentId: string,
    evidenceRef: string,
    deps: IntentTransitionDeps,
  ): DistributionIntent {
    const all = this.readAll();
    const current = this.findIntent(all, tenantId, intentId);
    const next = recordExecution(current, evidenceRef, deps);
    this.persist(all, next);
    return next;
  }

  /** 输入解析：shape 失败投影为类型化 IntentValidationError（fail-closed）。 */
  private parseInput(input: DistributionIntentInput): DistributionIntentInput {
    try {
      return parseOrFail(
        "DistributionIntentInput",
        distributionIntentInputSchema,
        input,
      ) as DistributionIntentInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new IntentValidationError(error.issues);
      }
      throw error;
    }
  }

  /** 在已读集合中定位单条意图：未命中 → IntentNotFoundError；他租户记录 → InvariantViolation。 */
  private findIntent(
    all: readonly DistributionIntent[],
    tenantId: string,
    intentId: string,
  ): DistributionIntent {
    const found = all.find((record) => record.id === intentId);
    if (found === undefined) {
      throw new IntentNotFoundError(tenantId, intentId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "distribution intent");
    return found;
  }

  /** 落盘前统一守卫：schema + 不变量 §22（每条持久记录都过，defense in depth）。 */
  private persist(
    all: readonly DistributionIntent[],
    record: DistributionIntent,
  ): void {
    const validated = parseOrFail(
      "DistributionIntent",
      distributionIntentSchema,
      record,
    ) as DistributionIntent;
    assertDistributionPreviewApproval(validated);
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
  private readAll(): readonly DistributionIntent[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("DistributionIntentStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("DistributionIntentStore", [
        "存储文件结构必须是 { version, intents }",
      ]);
    }
    const intents = (parsed as { intents?: unknown }).intents;
    if (!Array.isArray(intents)) {
      throw new ContractValidationError("DistributionIntentStore", [
        "存储文件缺少 intents 数组",
      ]);
    }
    return intents.map(
      (record) =>
        parseOrFail("DistributionIntent", distributionIntentSchema, record) as DistributionIntent,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(intents: readonly DistributionIntent[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, intents }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
