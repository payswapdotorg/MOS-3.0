import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertGraphEngineRefsOpaque,
  assertTenantScope,
  ContractValidationError,
  parseOrFail,
  productionGraphSchema,
} from "@mos/contracts";
import type { ProductionGraph } from "@mos/contracts";
import {
  GraphNotFoundError,
  GraphValidationError,
  graphInputSchema,
} from "../contract/graph.js";
import type { EngineLookup, GraphInput, TransformLookup } from "../contract/graph.js";
import { validateGraph } from "../domain/graph-validation.js";
import type { TimePort } from "../contract.js";
import { SystemTimePort } from "./system-time.js";
import { deepEqual, describeError } from "./support.js";

const STORE_FILE_NAME = "mos-production-graphs.json";
const STORE_SCHEMA_VERSION = 1;

/** 校验门禁的查找端口集（transform/engine 记录经结构化端口解析——决策锁 #9）。 */
export interface GraphValidationLookups {
  readonly transformLookup: TransformLookup;
  readonly engineLookup: EngineLookup;
}

export interface GraphStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 时钟（validate 写 validated_at / 各写路径推进 updated_at 用）；缺省为 SystemTimePort。 */
  readonly time?: TimePort;
}

/**
 * 持久 tenant-scoped ProductionGraph 存储（authority: production；决策锁 #5/#9）。
 *
 * - 图是“生产程序描述”，不是执行器：validated 只是结构/引用校验通过的状态标记。
 * - 文件后端：注入目录下单文件 mos-production-graphs.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/schema 损坏 fail-closed。
 * - saveDraft（upsert by id，恒为 draft）：内容变化 → version+1、status=draft、
 *   validated_at=null、validation_errors=[]、updated_at=now（created_at 保留——
 *   改动后的图必须重新过 validate 门禁）；内容未变 → 幂等直返（不写文件、不 bump）。
 * - validate（fail-closed 门禁）：跑 domain/validateGraph（结构 + 引用检查，全部错误
 *   具名收集）：
 *   - 成功：status=validated、validated_at=时钟当前值、validation_errors=[]，
 *     并调用 assertGraphEngineRefsOpaque 最终守卫（invariants §20）后落盘；
 *     校验状态是当前版本的标注，不 bump version；
 *   - 失败：先把具名错误落盘（原 draft 保持 draft；原 validated → invalidated，
 *     validated_at=null——有错误的图绝不保持 validated），再抛
 *     GraphValidationError（携带同名错误）——记录与异常双通道，绝不静默。
 * - 跨租户：saveDraft 遇他租户同 id 记录、get/validate 命中他租户记录 →
 *   assertTenantScope InvariantViolation；get/validate 对不存在的 id → GraphNotFoundError。
 * - transform/engine 引用只经注入端口解析（TransformLookup/EngineLookup），
 *   本包绝不 import @mos/engines（决策锁 #9；组合根负责接线到各注册表存储）。
 */
export class GraphStore {
  private readonly directory: string;
  private readonly time: TimePort;

  constructor(options: GraphStoreOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimePort();
  }

  /** 保存草稿（upsert by id，恒为 draft；内容变化才 bump version 并重置校验状态）。 */
  saveDraft(tenantId: string, graphId: string, input: GraphInput): ProductionGraph {
    const normalized = parseOrFail(
      "GraphInput",
      graphInputSchema,
      input,
    ) as GraphInput;

    const all = this.readAll();
    const existing = all.find((record) => record.id === graphId);
    if (existing !== undefined) {
      // 跨租户 upsert 显式拒绝（绝不静默新建同 id 的他租户记录）。
      assertTenantScope(existing, { tenant_id: tenantId }, "ProductionGraph");
    }

    const now = this.time.now();
    const record: ProductionGraph =
      existing === undefined
        ? parseOrFail("ProductionGraph", productionGraphSchema, {
            id: graphId,
            tenant_id: tenantId,
            mission_id: normalized.mission_id,
            version: 1,
            name: normalized.name,
            nodes: normalized.nodes.map((node) => ({ ...node })),
            edges: normalized.edges.map((edge) => ({ ...edge })),
            status: "draft",
            validated_at: null,
            validation_errors: [],
            created_at: now,
            updated_at: now,
          }) as ProductionGraph
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

  /**
   * 校验图（fail-closed 门禁）：
   * 成功 → status=validated + validated_at=时钟当前值 + validation_errors=[]
   * （+ assertGraphEngineRefsOpaque 最终守卫）；
   * 失败 → 具名错误落盘（draft 保持 draft；原 validated → invalidated）后抛
   * GraphValidationError（携带同名错误）——有错误的图绝不 validated。
   */
  validate(
    tenantId: string,
    graphId: string,
    lookups: GraphValidationLookups,
  ): ProductionGraph {
    const graph = this.get(tenantId, graphId);
    const result = validateGraph({
      graph,
      transformLookup: lookups.transformLookup,
      engineLookup: lookups.engineLookup,
    });

    const now = this.time.now();
    if (result.valid) {
      const validated = parseOrFail("ProductionGraph", productionGraphSchema, {
        ...graph,
        status: "validated",
        validated_at: now,
        validation_errors: [],
        updated_at: now,
      }) as ProductionGraph;
      // invariants §20 最终守卫：validated 图的 engine 节点引用必须已解析（不透明且非空）。
      assertGraphEngineRefsOpaque(validated);
      this.persistRecord(validated);
      return validated;
    }

    // 失败：具名错误落盘（原 validated → invalidated；其余保持 draft），
    // 再抛 GraphValidationError——记录与异常双通道，绝不静默。
    const failed = parseOrFail("ProductionGraph", productionGraphSchema, {
      ...graph,
      status: graph.status === "validated" ? "invalidated" : "draft",
      validated_at: null,
      validation_errors: [...result.errors],
      updated_at: now,
    }) as ProductionGraph;
    this.persistRecord(failed);
    throw new GraphValidationError(result.errors);
  }

  /** 读取单张图；id 不存在抛 GraphNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, graphId: string): ProductionGraph {
    const found = this.readAll().find((record) => record.id === graphId);
    if (found === undefined) {
      throw new GraphNotFoundError(tenantId, graphId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "ProductionGraph");
    return found;
  }

  /** 列出 tenant 的全部图（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly ProductionGraph[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 内容变化 → version+1 + 校验状态重置为 draft；未变 → 原记录直返。 */
  private nextVersion(
    existing: ProductionGraph,
    normalized: GraphInput,
    now: string,
  ): ProductionGraph {
    const unchanged =
      existing.name === normalized.name &&
      existing.mission_id === normalized.mission_id &&
      deepEqual(existing.nodes, normalized.nodes.map((node) => ({ ...node }))) &&
      deepEqual(existing.edges, normalized.edges.map((edge) => ({ ...edge })));
    if (unchanged) {
      return existing;
    }
    return parseOrFail("ProductionGraph", productionGraphSchema, {
      ...existing,
      version: existing.version + 1,
      name: normalized.name,
      mission_id: normalized.mission_id,
      nodes: normalized.nodes.map((node) => ({ ...node })),
      edges: normalized.edges.map((edge) => ({ ...edge })),
      // 改动后的图必须重新过 validate 门禁：校验状态显式重置。
      status: "draft",
      validated_at: null,
      validation_errors: [],
      updated_at: now,
    }) as ProductionGraph;
  }

  /** upsert 持久化（原子写）。 */
  private persistRecord(graph: ProductionGraph): void {
    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === graph.tenant_id && record.id === graph.id,
    );
    this.writeAll(
      existing === undefined
        ? [...all, graph]
        : all.map((record) => (record === existing ? graph : record)),
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly ProductionGraph[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("GraphStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("GraphStore", [
        "存储文件结构必须是 { version, graphs }",
      ]);
    }
    const graphs = (parsed as { graphs?: unknown }).graphs;
    if (!Array.isArray(graphs)) {
      throw new ContractValidationError("GraphStore", [
        "存储文件缺少 graphs 数组",
      ]);
    }
    return graphs.map(
      (record) =>
        parseOrFail("ProductionGraph", productionGraphSchema, record) as ProductionGraph,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(graphs: readonly ProductionGraph[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, graphs }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
