import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  agentBodySchema,
  assertTenantScope,
  ContractValidationError,
  parseOrFail,
} from "@mos/contracts";
import type { AgentBody } from "@mos/contracts";
import { AgentBodyNotFoundError, AgentBodyValidationError } from "../contract/agent-body.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-agent-bodies.json";
const STORE_SCHEMA_VERSION = 1;

export interface AgentBodyStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped AgentBody 存储。
 *
 * - 文件后端：注入目录下单文件 mos-agent-bodies.json；原子写（先写同目录 tmp 再 rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）。
 * - 写边界：save 先过 agentBodySchema（失败抛类型化 AgentBodyValidationError），
 *   再过 assertTenantScope（跨租户写入 fail-closed 抛 InvariantViolation）；
 *   save 是逐字 upsert，不改时间戳（时间戳由调用方记录携带）。
 * - 读边界：get 对不存在的 id 抛 AgentBodyNotFoundError；记录存在但属于其他租户时
 *   由 assertTenantScope 拒绝（InvariantViolation，绝不当作"不存在"处理）。
 * - 不存任何密钥/凭据：记录只含不透明引用与描述性字段（invariants §8 边界）。
 * - 读取按 zod 默认策略容忍未知键（additive 演化），结构损坏 fail-closed 抛错。
 */
export class AgentBodyStore {
  private readonly directory: string;

  constructor(options: AgentBodyStoreOptions) {
    this.directory = options.directory;
  }

  /** 保存（upsert）一条 AgentBody；同 (tenant, id) 原位替换，不产生重复记录。 */
  save(tenantId: string, body: AgentBody): AgentBody {
    const validated = this.parseForSave(body);
    assertTenantScope(validated, { tenant_id: tenantId }, "AgentBody");

    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === tenantId && record.id === validated.id,
    );

    if (!existing) {
      this.writeAll([...all, validated]);
      return validated;
    }

    this.writeAll(all.map((record) => (record === existing ? validated : record)));
    return validated;
  }

  /** 读取单条 AgentBody；id 不存在抛 AgentBodyNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, agentBodyId: string): AgentBody {
    const found = this.readAll().find((record) => record.id === agentBodyId);
    if (!found) {
      throw new AgentBodyNotFoundError(agentBodyId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "AgentBody");
    return found;
  }

  /** 列出 tenant 的全部 AgentBody（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly AgentBody[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 写边界校验：schema 失败投影为类型化 AgentBodyValidationError（fail-closed）。 */
  private parseForSave(body: AgentBody): AgentBody {
    try {
      return parseOrFail("AgentBody", agentBodySchema, body) as AgentBody;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new AgentBodyValidationError(error.issues);
      }
      throw error;
    }
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly AgentBody[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("AgentBodyStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("AgentBodyStore", [
        "存储文件结构必须是 { version, agent_bodies }",
      ]);
    }
    const bodies = (parsed as { agent_bodies?: unknown }).agent_bodies;
    if (!Array.isArray(bodies)) {
      throw new ContractValidationError("AgentBodyStore", [
        "存储文件缺少 agent_bodies 数组",
      ]);
    }
    return bodies.map(
      (record) => parseOrFail("AgentBody", agentBodySchema, record) as AgentBody,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(bodies: readonly AgentBody[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, agent_bodies: bodies }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
