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
  transformSchema,
} from "@mos/contracts";
import type { Transform } from "@mos/contracts";
import {
  TransformNotFoundError,
  TransformValidationError,
  transformDefinitionInputSchema,
} from "../contract/transform.js";
import type { TransformDefinitionInput } from "../contract/transform.js";
import type { TimePort } from "../contract.js";
import { SystemTimePort } from "./system-time.js";
import { deepEqual, describeError } from "./support.js";

const STORE_FILE_NAME = "mos-transforms.json";
const STORE_SCHEMA_VERSION = 1;

export interface TransformRegistryOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 时钟（register 推进 updated_at 用）；缺省为 SystemTimePort。 */
  readonly time?: TimePort;
}

/**
 * 持久 tenant-scoped Transform 定义注册表（authority: production）。
 *
 * - Transform 只是“期望操作定义”（clip/crop/translate/dub/…），不是执行
 *   （决策锁 #5——执行归 ZCode；required_capability_id 是不透明能力引用）。
 * - 文件后端：注入目录下单文件 mos-transforms.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/schema 损坏 fail-closed。
 * - register（upsert by id，内容变化才 bump version）：
 *   输入先过 transformDefinitionInputSchema（失败 → 类型化 TransformValidationError）；
 *   同 (tenant, id) 内容未变 → 幂等直返（不写文件、不改时间戳、不 bump 版本）；
 *   内容变化 → version+1（created_at 保留）+ updated_at=时钟当前值。
 * - 跨租户：register 遇他租户同 id 记录、get 命中他租户记录 → assertTenantScope
 *   InvariantViolation；get 对不存在的 id → TransformNotFoundError。
 * - 读取容忍未知键（additive），结构损坏 fail-closed 抛 ContractValidationError。
 * - 不存任何密钥/凭据：记录只含描述性字段与不透明能力引用。
 */
export class TransformRegistry {
  private readonly directory: string;
  private readonly time: TimePort;

  constructor(options: TransformRegistryOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimePort();
  }

  /** 注册/更新（upsert by id）一条 Transform 定义；内容变化才 bump version。 */
  register(
    tenantId: string,
    transformId: string,
    input: TransformDefinitionInput,
  ): Transform {
    const normalized = this.parseInput(input);

    const all = this.readAll();
    const existing = all.find((record) => record.id === transformId);
    if (existing !== undefined) {
      // 跨租户 upsert 显式拒绝（绝不静默新建同 id 的他租户记录）。
      assertTenantScope(existing, { tenant_id: tenantId }, "Transform");
    }

    const now = this.time.now();
    const record: Transform =
      existing === undefined
        ? parseOrFail("Transform", transformSchema, {
            id: transformId,
            tenant_id: tenantId,
            version: 1,
            name: normalized.name,
            description: normalized.description,
            parameters_schema: { ...normalized.parameters_schema },
            required_capability_id: normalized.required_capability_id,
            side_effect: normalized.side_effect,
            risk_level: normalized.risk_level,
            status: normalized.status,
            created_at: now,
            updated_at: now,
          }) as Transform
        : this.nextVersion(existing, normalized, now);

    if (existing !== undefined && record === existing) {
      // 内容未变：幂等直返，不写文件、不 bump 版本、不改时间戳。
      return existing;
    }

    this.writeAll(
      existing === undefined
        ? [...all, record]
        : all.map((item) => (item === existing ? record : item)),
    );
    return record;
  }

  /** 读取单条 Transform；id 不存在抛 TransformNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, transformId: string): Transform {
    const found = this.readAll().find((record) => record.id === transformId);
    if (found === undefined) {
      throw new TransformNotFoundError(transformId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "Transform");
    return found;
  }

  /** 列出 tenant 的全部 Transform 定义（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly Transform[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 输入 schema 校验：失败投影为类型化 TransformValidationError（fail-closed）。 */
  private parseInput(input: TransformDefinitionInput): TransformDefinitionInput {
    try {
      return parseOrFail(
        "TransformDefinitionInput",
        transformDefinitionInputSchema,
        input,
      ) as TransformDefinitionInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new TransformValidationError(error.issues);
      }
      throw error;
    }
  }

  /** 内容变化 → version+1（created_at 保留）+ updated_at=now；未变 → 原记录直返。 */
  private nextVersion(
    existing: Transform,
    normalized: TransformDefinitionInput,
    now: string,
  ): Transform {
    const unchanged =
      existing.name === normalized.name &&
      existing.description === normalized.description &&
      deepEqual(existing.parameters_schema, { ...normalized.parameters_schema }) &&
      existing.required_capability_id === normalized.required_capability_id &&
      existing.side_effect === normalized.side_effect &&
      existing.risk_level === normalized.risk_level &&
      existing.status === normalized.status;
    if (unchanged) {
      return existing;
    }
    return parseOrFail("Transform", transformSchema, {
      ...existing,
      version: existing.version + 1,
      name: normalized.name,
      description: normalized.description,
      parameters_schema: { ...normalized.parameters_schema },
      required_capability_id: normalized.required_capability_id,
      side_effect: normalized.side_effect,
      risk_level: normalized.risk_level,
      status: normalized.status,
      updated_at: now,
    }) as Transform;
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Transform[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("TransformRegistry", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("TransformRegistry", [
        "存储文件结构必须是 { version, transforms }",
      ]);
    }
    const transforms = (parsed as { transforms?: unknown }).transforms;
    if (!Array.isArray(transforms)) {
      throw new ContractValidationError("TransformRegistry", [
        "存储文件缺少 transforms 数组",
      ]);
    }
    return transforms.map(
      (record) => parseOrFail("Transform", transformSchema, record) as Transform,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(transforms: readonly Transform[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, transforms }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
