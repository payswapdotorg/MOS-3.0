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
  organizationSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Organization } from "@mos/contracts";
import {
  OrganizationNotFoundError,
  OrganizationValidationError,
} from "../contract/organization.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-organizations.json";
const STORE_SCHEMA_VERSION = 1;

export interface OrganizationStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped Organization 存储（与 AgentBodyStore 同构）。
 *
 * - 文件后端：单文件 mos-organizations.json；原子写（同目录 tmp + rename）；文件缺失 → 空启动。
 * - 写边界：organizationSchema + assertTenantScope（跨租户写入 fail-closed）；
 *   save 是逐字 upsert，不改时间戳。
 * - 读边界：id 不存在抛 OrganizationNotFoundError；跨租户读取由 assertTenantScope
 *   拒绝（InvariantViolation，绝不当作"不存在"处理）。
 * - 读取容忍未知键（additive 演化），结构损坏 fail-closed 抛错。
 */
export class OrganizationStore {
  private readonly directory: string;

  constructor(options: OrganizationStoreOptions) {
    this.directory = options.directory;
  }

  /** 保存（upsert）一条 Organization；同 (tenant, id) 原位替换。 */
  save(tenantId: string, organization: Organization): Organization {
    const validated = this.parseForSave(organization);
    assertTenantScope(validated, { tenant_id: tenantId }, "Organization");

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

  /** 读取单条 Organization；id 不存在抛 OrganizationNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, organizationId: string): Organization {
    const found = this.readAll().find((record) => record.id === organizationId);
    if (!found) {
      throw new OrganizationNotFoundError(organizationId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "Organization");
    return found;
  }

  /** 列出 tenant 的全部 Organization（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly Organization[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 写边界校验：schema 失败投影为类型化 OrganizationValidationError（fail-closed）。 */
  private parseForSave(organization: Organization): Organization {
    try {
      return parseOrFail("Organization", organizationSchema, organization) as Organization;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new OrganizationValidationError(error.issues);
      }
      throw error;
    }
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Organization[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("OrganizationStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("OrganizationStore", [
        "存储文件结构必须是 { version, organizations }",
      ]);
    }
    const organizations = (parsed as { organizations?: unknown }).organizations;
    if (!Array.isArray(organizations)) {
      throw new ContractValidationError("OrganizationStore", [
        "存储文件缺少 organizations 数组",
      ]);
    }
    return organizations.map(
      (record) => parseOrFail("Organization", organizationSchema, record) as Organization,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(organizations: readonly Organization[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify(
        { version: STORE_SCHEMA_VERSION, organizations },
        null,
        2,
      )}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
