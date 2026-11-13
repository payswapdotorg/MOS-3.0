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
  productionJobSchema,
} from "@mos/contracts";
import type { ProductionJob } from "@mos/contracts";
import { GraphNotFoundError } from "../contract/graph.js";
import {
  JobCreationBlockedError,
  JobEventValidationError,
  JobNotFoundError,
  jobCreationInputSchema,
  productionJobEventSchema,
} from "../contract/job.js";
import type {
  GraphLookup,
  JobCreationInput,
  ProductionJobEvent,
} from "../contract/job.js";
import { applyJobEvent } from "../domain/job-transitions.js";
import type { TimePort } from "../contract.js";
import { SystemTimePort } from "./system-time.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-production-jobs.json";
const STORE_SCHEMA_VERSION = 1;

export interface JobStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 时钟（创建/转移推进 updated_at 用）；缺省为 SystemTimePort。 */
  readonly time?: TimePort;
  /**
   * Graph 查找端口（结构化注入，决策锁 #5/#9）：job 创建要求图存在且 validated——
   * 端口按 (tenantId, graphId) 解析，未命中 → GraphNotFoundError（绝不猜测）。
   */
  readonly graphLookup: GraphLookup;
}

/**
 * 持久 tenant-scoped ProductionJob 存储（authority: production；决策锁 #5）。
 *
 * - MOS 只记录持久业务状态：本类没有任何启动/运行/执行方法——
 *   zcode_execution_ref 是组合根供给的不透明外部引用（指向 ZCode 侧执行），
 *   linked→executing 只能经外部观测事件记录（domain/job-transitions.ts 转移表 +
 *   assertJobNeverExecutes 最终守卫，绝不绕过）。
 * - createJob：图必须存在（graphLookup 未命中 → GraphNotFoundError；坏端口返回
 *   他租户图 → assertTenantScope InvariantViolation）、必须 status=validated、
 *   且 graph_version 必须等于图当前版本（不匹配 → JobCreationBlockedError 具名）；
 *   job id 已存在 → JobCreationBlockedError（job 是 durable 状态记录，不可覆盖）。
 *   创建恒为 status=pending、zcode_execution_ref=null。
 * - applyTransition：事件先过 productionJobEventSchema（失败 → JobEventValidationError），
 *   再走 domain 转移表（非法转移/缺失数据 → JobTransitionError）+ assertJobNeverExecutes。
 * - 跨租户：createJob 遇他租户同 id 记录、get/applyTransition 命中他租户记录 →
 *   assertTenantScope InvariantViolation；get/applyTransition 对不存在的 id →
 *   JobNotFoundError。
 * - 文件后端：单文件 mos-production-jobs.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动；JSON/结构/schema 损坏 fail-closed。
 */
export class JobStore {
  private readonly directory: string;
  private readonly time: TimePort;
  private readonly graphLookup: GraphLookup;

  constructor(options: JobStoreOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimePort();
    this.graphLookup = options.graphLookup;
  }

  /**
   * 创建 job（恒为 pending）：图必须存在且 validated，graph_version 必须等于
   * 图当前版本；job id 已存在则拒绝（durable 状态记录不可覆盖）。
   */
  createJob(tenantId: string, jobId: string, input: JobCreationInput): ProductionJob {
    const normalized = parseOrFail(
      "JobCreationInput",
      jobCreationInputSchema,
      input,
    ) as JobCreationInput;

    // 图必须存在且属于调用方租户（端口未命中 → GraphNotFoundError；他租户图 fail-closed）。
    const graph = this.graphLookup(tenantId, normalized.graph_id);
    if (graph === undefined) {
      throw new GraphNotFoundError(tenantId, normalized.graph_id);
    }
    assertTenantScope(graph, { tenant_id: tenantId }, "ProductionGraph");

    // fail-closed 门禁：只有 validated 图可承载 job；版本必须钉住当前版本。
    if (graph.status !== "validated") {
      throw new JobCreationBlockedError(
        `graph ${normalized.graph_id} status=${graph.status}: job creation requires a validated graph`,
      );
    }
    if (normalized.graph_version !== graph.version) {
      throw new JobCreationBlockedError(
        `graph ${normalized.graph_id} version mismatch: job references v${normalized.graph_version}, current version is v${graph.version}`,
      );
    }

    // job id 唯一（跨租户同 id 也拒绝——绝不静默新建）。
    const all = this.readAll();
    const existing = all.find((record) => record.id === jobId);
    if (existing !== undefined) {
      assertTenantScope(existing, { tenant_id: tenantId }, "ProductionJob");
      throw new JobCreationBlockedError(`job ${jobId} already exists`);
    }

    const now = this.time.now();
    const record = parseOrFail("ProductionJob", productionJobSchema, {
      id: jobId,
      tenant_id: tenantId,
      graph_id: normalized.graph_id,
      graph_version: normalized.graph_version,
      status: "pending",
      zcode_execution_ref: null,
      started_at: null,
      completed_at: null,
      output_artifact_refs: [],
      failure: null,
      created_at: now,
      updated_at: now,
    }) as ProductionJob;

    this.writeAll([...all, record]);
    return record;
  }

  /**
   * 应用状态转移（唯一的状态演化写路径）：
   * 事件 schema 校验（JobEventValidationError）→ domain 转移表（JobTransitionError）
   * → assertJobNeverExecutes 最终守卫（决策锁 #5——执行归 ZCode，MOS 只记录状态）。
   */
  applyTransition(
    tenantId: string,
    jobId: string,
    event: ProductionJobEvent,
  ): ProductionJob {
    const job = this.get(tenantId, jobId);
    const normalizedEvent = this.parseEvent(event);
    const updated = applyJobEvent(job, normalizedEvent, this.time.now());
    const all = this.readAll();
    this.writeAll(all.map((record) => (record === job ? updated : record)));
    return updated;
  }

  /** 读取单条 job；id 不存在抛 JobNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, jobId: string): ProductionJob {
    const found = this.readAll().find((record) => record.id === jobId);
    if (found === undefined) {
      throw new JobNotFoundError(jobId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "ProductionJob");
    return found;
  }

  /** 列出 tenant 的全部 job（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly ProductionJob[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 事件 schema 校验：失败投影为类型化 JobEventValidationError（fail-closed）。 */
  private parseEvent(event: ProductionJobEvent): ProductionJobEvent {
    try {
      return parseOrFail(
        "ProductionJobEvent",
        productionJobEventSchema,
        event,
      ) as ProductionJobEvent;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new JobEventValidationError(error.issues);
      }
      throw error;
    }
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly ProductionJob[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("JobStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("JobStore", [
        "存储文件结构必须是 { version, jobs }",
      ]);
    }
    const jobs = (parsed as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) {
      throw new ContractValidationError("JobStore", [
        "存储文件缺少 jobs 数组",
      ]);
    }
    return jobs.map(
      (record) => parseOrFail("ProductionJob", productionJobSchema, record) as ProductionJob,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(jobs: readonly ProductionJob[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, jobs }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
