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
  engineSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Engine } from "@mos/contracts";
import {
  EngineNotFoundError,
  EngineValidationError,
  engineRegistrationInputSchema,
} from "../contract/engine.js";
import type { EngineRegistrationInput } from "../contract/engine.js";
import {
  SandboxPolicyValidationError,
  validateSandboxPolicy,
} from "../contract/sandbox-policy.js";
import type { SandboxPolicy } from "../contract/sandbox-policy.js";
import { matchEnginesForCapability } from "../domain/matching.js";
import type { CapabilityEngineMatchResult } from "../domain/matching.js";
import type { TimeSource } from "../contract.js";
import { SystemTimeSource } from "./system-time.js";
import { deepEqual, describeError } from "./support.js";

const STORE_FILE_NAME = "mos-engines.json";
const STORE_SCHEMA_VERSION = 1;

export interface EngineRegistryOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 时钟（register 推进 updated_at 用）；缺省为 SystemTimeSource。 */
  readonly time?: TimeSource;
}

/**
 * 持久 tenant-scoped Engine 注册表（authority: engines；决策锁 #9）。
 *
 * - 本类只有注册表记录 + 能力匹配：没有任何 engine 导入，没有任何调用/执行路径
 *   （实际执行适配器是组合根的职责；sandbox_policy 只是描述符，不是执行配置）。
 * - 文件后端：注入目录下单文件 mos-engines.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/schema 损坏 fail-closed。
 * - register（upsert by id，内容变化才 bump version）：
 *   输入先过 engineRegistrationInputSchema（失败 → 类型化 EngineValidationError），
 *   sandbox_policy 再过 validateSandboxPolicy fail-closed 校验（失败同样 →
 *   EngineValidationError，携带具名 issues），以规范化描述符落库；
 *   同 (tenant, id) 内容未变 → 幂等直返（不写文件、不改时间戳、不 bump 版本）；
 *   内容变化 → version+1（created_at 保留）、updated_at=时钟当前值。
 * - 跨租户：register 对他租户同 id 记录、get 命中他租户记录 → assertTenantScope
 *   InvariantViolation（fail-closed）；get 对不存在的 id → EngineNotFoundError。
 * - 读边界：每条记录过 engineSchema + validateSandboxPolicy（策略描述符损坏的记录
 *   fail-closed，绝不作为可用 engine 表面化）。
 * - listForCapability：先按 tenant 过滤，再交领域纯匹配器（deprecated/unknown 状态
 *   显式落在 excluded，绝不静默隐藏也绝不静默匹配）。
 * - 不存任何密钥/凭据：记录只含不透明引用与描述性字段。
 */
export class EngineRegistry {
  private readonly directory: string;
  private readonly time: TimeSource;

  constructor(options: EngineRegistryOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimeSource();
  }

  /**
   * 注册/更新（upsert by id）一条 Engine 记录：
   * 输入与 sandbox_policy 双重 fail-closed 校验；内容变化才 bump version。
   */
  register(
    tenantId: string,
    engineId: string,
    input: EngineRegistrationInput,
  ): Engine {
    const normalized = this.parseInput(input);
    const policy = this.parsePolicy(normalized.sandbox_policy);

    const all = this.readAll();
    const existing = all.find((record) => record.id === engineId);
    if (existing !== undefined) {
      // 跨租户 upsert 显式拒绝（绝不静默新建同 id 的他租户记录）。
      assertTenantScope(existing, { tenant_id: tenantId }, "Engine");
    }

    const now = this.time.now();
    const record: Engine =
      existing === undefined
        ? parseOrFail("Engine", engineSchema, {
            id: engineId,
            tenant_id: tenantId,
            version: 1,
            display_name: normalized.display_name,
            capability_ids: [...normalized.capability_ids],
            provider_id: normalized.provider_id,
            sandbox_policy: policy,
            benchmark_refs: [...normalized.benchmark_refs],
            license_terms: normalized.license_terms,
            cost_model: normalized.cost_model,
            status: normalized.status,
            created_at: now,
            updated_at: now,
          }) as Engine
        : this.nextVersion(existing, normalized, policy, now);

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

  /** 读取单条 Engine；id 不存在抛 EngineNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, engineId: string): Engine {
    const found = this.readAll().find((record) => record.id === engineId);
    if (found === undefined) {
      throw new EngineNotFoundError(engineId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "Engine");
    return found;
  }

  /** 列出 tenant 的全部 Engine（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly Engine[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /**
   * 按能力匹配 engine：只在该 tenant 的注册记录上运行领域匹配器；
   * matched 只含 registered/benchmarked，deprecated/unknown 显式落在 excluded，
   * 无任何 engine 覆盖该能力时 noEngineRegistered=true（未知能力不是错误）。
   */
  listForCapability(
    tenantId: string,
    capabilityId: string,
  ): CapabilityEngineMatchResult {
    return matchEnginesForCapability({
      engines: this.listByTenant(tenantId),
      capabilityId,
    });
  }

  /** 输入 schema 校验：失败投影为类型化 EngineValidationError（fail-closed）。 */
  private parseInput(input: EngineRegistrationInput): EngineRegistrationInput {
    try {
      return parseOrFail(
        "EngineRegistrationInput",
        engineRegistrationInputSchema,
        input,
      ) as EngineRegistrationInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new EngineValidationError(error.issues);
      }
      throw error;
    }
  }

  /** sandbox_policy fail-closed 校验：失败同样投影为 EngineValidationError。 */
  private parsePolicy(policy: unknown): SandboxPolicy {
    try {
      return validateSandboxPolicy(policy);
    } catch (error) {
      if (error instanceof SandboxPolicyValidationError) {
        throw new EngineValidationError(error.issues);
      }
      throw error;
    }
  }

  /** 内容变化 → version+1（created_at 保留）+ updated_at=now；未变 → 原记录直返。 */
  private nextVersion(
    existing: Engine,
    normalized: EngineRegistrationInput,
    policy: SandboxPolicy,
    now: string,
  ): Engine {
    const unchanged =
      existing.display_name === normalized.display_name &&
      deepEqual(existing.capability_ids, [...normalized.capability_ids]) &&
      existing.provider_id === normalized.provider_id &&
      deepEqual(existing.sandbox_policy, policy) &&
      deepEqual(existing.benchmark_refs, [...normalized.benchmark_refs]) &&
      existing.license_terms === normalized.license_terms &&
      deepEqual(existing.cost_model, normalized.cost_model) &&
      existing.status === normalized.status;
    if (unchanged) {
      return existing;
    }
    return parseOrFail("Engine", engineSchema, {
      ...existing,
      version: existing.version + 1,
      display_name: normalized.display_name,
      capability_ids: [...normalized.capability_ids],
      provider_id: normalized.provider_id,
      sandbox_policy: policy,
      benchmark_refs: [...normalized.benchmark_refs],
      license_terms: normalized.license_terms,
      cost_model: normalized.cost_model,
      status: normalized.status,
      updated_at: now,
    }) as Engine;
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但 JSON/结构/schema/沙箱策略损坏必须 fail-closed。 */
  private readAll(): readonly Engine[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("EngineRegistry", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("EngineRegistry", [
        "存储文件结构必须是 { version, engines }",
      ]);
    }
    const engines = (parsed as { engines?: unknown }).engines;
    if (!Array.isArray(engines)) {
      throw new ContractValidationError("EngineRegistry", [
        "存储文件缺少 engines 数组",
      ]);
    }
    return engines.map((record) => {
      const engine = parseOrFail("Engine", engineSchema, record) as Engine;
      // 沙箱策略描述符是安全语义字段：损坏的记录 fail-closed，绝不表面化。
      const policy = validateSandboxPolicy(engine.sandbox_policy);
      return parseOrFail("Engine", engineSchema, {
        ...engine,
        sandbox_policy: policy,
      }) as Engine;
    });
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(engines: readonly Engine[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, engines }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
