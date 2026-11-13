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
} from "@mos/contracts";
import type { Artifact } from "@mos/contracts";
import {
  ArtifactNotFoundError,
  ArtifactValidationError,
  ArtifactVersionConflictError,
  artifactRecordSchema,
  artifactVersionInputSchema,
} from "../contract/artifact.js";
import type { ArtifactVersionInput } from "../contract/artifact.js";
import type { ArtifactVersionDeps } from "../contract.js";
import { lineageAppend, nextVersion } from "../domain/artifact-lineage.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-artifacts.json";
const STORE_SCHEMA_VERSION = 1;

export interface ArtifactStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped Artifact 版本存储（authority: artifacts；W2 store 同构）。
 *
 * - 文件后端：注入目录下单文件 mos-artifacts.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/记录损坏 fail-closed
 *   抛 ContractValidationError（读边界绝不静默补全——记录 schema 无默认值）。
 * - 版本链（不变量 §7 + 工作包规则，全部在写边界强制）：
 *   - registerFirstVersion：恒为 version 1，输入的 parent_artifact_refs 必须为空
 *     （首版本没有可引用的父系血缘）；artifact 已存在（同 id 任何租户）→
 *     ArtifactVersionConflictError；
 *   - registerNextVersion：version 恒为 previous.version + 1（nextVersion 推导，
 *     调用方无法表达跳级）；输入的 parent_artifact_refs 必须逐字等于上一版本的
 *     血缘（"parent refs must equal previous lineage"）——血缘改写尝试 →
 *     ArtifactVersionConflictError；artifact 不存在 → ArtifactNotFoundError；
 *   - 两条路径都经 domain/artifact-lineage.ts 的 lineageAppend（领域规则）
 *     + assertArtifactLineageImmutability（契约最终守卫，不变量 §7）。
 * - 血缘语义：parent_artifact_refs 是 artifact 的派生血缘（指向父 artifact 版本的
 *   不透明引用），跨版本逐字携带；本包写边界产出的血缘恒为空（首版本必须为空 +
 *   后续逐字携带）——带非空血缘的派生 artifact 写入 deferred（组合根/后续周），
 *   读取面（artifactRecordSchema + listChildren）已按共享 schema 支持。
 * - tenant 边界：artifact id 在存储内全局唯一（跨租户同 id 写入显式拒绝，与 W2
 *   get-by-id 语义一致）：registerFirstVersion/registerNextVersion 遇他租户同 id
 *   记录、getVersion/latestVersion 命中他租户记录 → assertTenantScope
 *   InvariantViolation（跨租户访问绝不当作"不存在"处理）；listByTenant /
 *   listChildren 只返回调用方租户的记录。
 * - 永不保存内容字节：content_ref 只是不透明引用字符串（输入 schema 复用
 *   opaqueRef——疑似内联令牌值 fail-closed）；本存储无任何内容载荷字段。
 * - quality_status / rights_status 经不可变版本链演化：每个新版本携带新状态，
 *   已发布版本永不改写（无原地状态迁移 API）。
 */
export class ArtifactStore {
  private readonly directory: string;

  constructor(options: ArtifactStoreOptions) {
    this.directory = options.directory;
  }

  /**
   * 注册首版本（version 1）：输入血缘必须为空；artifact 已存在 →
   * ArtifactVersionConflictError；同 id 属他租户 → InvariantViolation。
   */
  registerFirstVersion(
    tenantId: string,
    input: ArtifactVersionInput,
    deps: ArtifactVersionDeps,
  ): Artifact {
    const normalized = this.parseInput(input);

    // 存在性 + tenant 检查：同 id 的任何现存记录都阻止首版本注册。
    const existing = this.readAll().find((record) => record.id === normalized.id);
    if (existing !== undefined) {
      // 他租户同 id → 跨租户写入 fail-closed；本租户 → 首版本已存在冲突。
      assertTenantScope(existing, { tenant_id: tenantId }, "Artifact");
      throw new ArtifactVersionConflictError(
        normalized.id,
        `artifact 已存在（最新版本 v${existing.version}），首版本只能注册一次`,
      );
    }

    const candidate: Artifact = {
      id: normalized.id,
      tenant_id: tenantId,
      kind: normalized.kind,
      version: 1,
      content_ref: normalized.content_ref,
      parent_artifact_refs: [...normalized.parent_artifact_refs],
      transform_id: null,
      created_by: { ...normalized.created_by },
      provenance: normalized.provenance.map((entry) => ({ ...entry })),
      rights_status: normalized.rights_status,
      quality_status: normalized.quality_status,
      created_at: deps.now,
    };

    // 领域规则（首版本 = version 1 + 空血缘）+ 契约守卫。
    lineageAppend(null, candidate);

    const persisted = this.materialize(candidate);
    this.writeAll([...this.readAll(), persisted]);
    return persisted;
  }

  /**
   * 注册下一版本（version = previous.version + 1，版本号由版本链推导——
   * 跳级在写边界结构上不可表达）：输入血缘必须逐字等于上一版本血缘
   * （血缘改写 → ArtifactVersionConflictError）；artifact 不存在 →
   * ArtifactNotFoundError；artifact 属他租户 → InvariantViolation。
   */
  registerNextVersion(
    tenantId: string,
    input: ArtifactVersionInput,
    deps: ArtifactVersionDeps,
  ): Artifact {
    const normalized = this.parseInput(input);

    // 上一版本 = 同 id 的最新版本（跨租户同 id → 显式拒绝，绝不静默接链）。
    const records = this.readAll().filter((record) => record.id === normalized.id);
    if (records.length === 0) {
      throw new ArtifactNotFoundError(normalized.id);
    }
    const own = records.filter((record) => record.tenant_id === tenantId);
    if (own.length === 0) {
      const [foreign] = records;
      if (foreign !== undefined) {
        assertTenantScope(foreign, { tenant_id: tenantId }, "Artifact");
      }
      throw new ArtifactNotFoundError(normalized.id);
    }
    const previous = own.reduce((max, record) =>
      record.version > max.version ? record : max,
    );

    const candidate: Artifact = {
      id: normalized.id,
      tenant_id: tenantId,
      kind: normalized.kind,
      version: nextVersion(previous),
      content_ref: normalized.content_ref,
      parent_artifact_refs: [...normalized.parent_artifact_refs],
      transform_id: null,
      created_by: { ...normalized.created_by },
      provenance: normalized.provenance.map((entry) => ({ ...entry })),
      rights_status: normalized.rights_status,
      quality_status: normalized.quality_status,
      created_at: deps.now,
    };

    // 领域规则（同 id + 严格 +1 + 血缘逐字携带）+ 契约守卫（不变量 §7）。
    lineageAppend(previous, candidate);

    const persisted = this.materialize(candidate);
    this.writeAll([...this.readAll(), persisted]);
    return persisted;
  }

  /** 读取指定版本；不存在抛 ArtifactNotFoundError，跨租户读取 fail-closed。 */
  getVersion(tenantId: string, artifactId: string, version: number): Artifact {
    const found = this.readAll().find(
      (record) => record.id === artifactId && record.version === version,
    );
    if (found === undefined) {
      throw new ArtifactNotFoundError(artifactId, version);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "Artifact");
    return found;
  }

  /** 读取该租户内 artifact 的最新版本；无任何版本抛 ArtifactNotFoundError。 */
  latestVersion(tenantId: string, artifactId: string): Artifact {
    const records = this.readAll().filter((record) => record.id === artifactId);
    if (records.length === 0) {
      throw new ArtifactNotFoundError(artifactId);
    }
    const own = records.filter((record) => record.tenant_id === tenantId);
    if (own.length === 0) {
      // 记录存在但全部属于其他租户 → 显式拒绝（绝不当作"不存在"处理）。
      const [foreign] = records;
      if (foreign !== undefined) {
        assertTenantScope(foreign, { tenant_id: tenantId }, "Artifact");
      }
      throw new ArtifactNotFoundError(artifactId);
    }
    return own.reduce((max, record) =>
      record.version > max.version ? record : max,
    );
  }

  /** 列出该租户的全部 artifact 版本记录（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly Artifact[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /**
   * 列出该租户内派生血缘包含 parentRef 的版本记录（不透明引用精确匹配，
   * 绝不解析引用结构）。本包写边界产出的血缘恒为空；该读取面为组合根写入的
   * 派生记录（共享 schema 允许非空血缘）提供 tenant-scoped 查询。
   */
  listChildren(tenantId: string, parentRef: string): readonly Artifact[] {
    return this.readAll().filter(
      (record) =>
        record.tenant_id === tenantId && record.parent_artifact_refs.includes(parentRef),
    );
  }

  /** 写边界校验：schema 失败投影为类型化 ArtifactValidationError（fail-closed）。 */
  private parseInput(input: ArtifactVersionInput): ArtifactVersionInput {
    try {
      return parseOrFail(
        "ArtifactVersionInput",
        artifactVersionInputSchema,
        input,
      ) as ArtifactVersionInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new ArtifactValidationError(error.issues);
      }
      throw error;
    }
  }

  /** 记录物化：无默认值记录 schema 全量校验（缺任何键 fail-closed）。 */
  private materialize(candidate: Artifact): Artifact {
    return parseOrFail("ArtifactRecord", artifactRecordSchema, candidate) as Artifact;
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Artifact[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("ArtifactStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("ArtifactStore", [
        "存储文件结构必须是 { version, artifacts }",
      ]);
    }
    const artifacts = (parsed as { artifacts?: unknown }).artifacts;
    if (!Array.isArray(artifacts)) {
      throw new ContractValidationError("ArtifactStore", [
        "存储文件缺少 artifacts 数组",
      ]);
    }
    return artifacts.map(
      (record) => parseOrFail("ArtifactRecord", artifactRecordSchema, record) as Artifact,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(artifacts: readonly Artifact[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, artifacts }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
