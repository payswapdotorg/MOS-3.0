import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import {
  assertExperimentOutcomeEvidence,
  assertTenantScope,
  ContractValidationError,
  experimentSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Experiment } from "@mos/contracts";
import {
  concludeExperimentInputSchema,
  experimentInputSchema,
  ExperimentNotFoundError,
  experimentTransitionSchema,
  ExperimentValidationError,
  HypothesisAdoptionError,
} from "../contract/experiment.js";
import type {
  ConcludeExperimentInput,
  ExperimentInput,
  ExperimentTransitionInput,
} from "../contract/experiment.js";
import {
  applyExperimentTransition,
  concludeExperiment,
  experimentFromInput,
} from "../domain/experiment-lifecycle.js";
import type {
  ExperimentCreationDeps,
  ExperimentTransitionDeps,
} from "../contract.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-experiments.json";
const STORE_SCHEMA_VERSION = 1;

export interface ExperimentStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped Experiment 存储（与 W1 mission-store / W2 lab store 同模式）。
 *
 * - 文件后端：注入目录下单文件 mos-experiments.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）；读取容忍未知键（additive），
 *   JSON/结构损坏 fail-closed 抛 ContractValidationError。
 * - 决策锁 #18：本存储是 outcome 的唯一写入方——outcome 只能经 conclude()
 *   （domain concludeExperiment：analyzed→concluded + 非空 measurement evidence refs
 *   + concluded_at，assertExperimentOutcomeEvidence 终守卫）；每条落盘记录再跑一次
 *   assertExperimentOutcomeEvidence（不变量 §21 具名，defense in depth——
 *   outcome 非 null 而 status 非 concluded 的记录不可能经任何写路径落盘）。
 * - define：输入 shape 失败 → ExperimentValidationError（类型化投影）；
 *   输入 tenant 与调用方不一致 → assertTenantScope InvariantViolation；
 *   创建恒为 status=defined（结果语义在创建形状上即不可表达）。
 * - applyTransition：全部经 domain 生命周期机器（非法边/跳态/回退 →
 *   ExperimentTransitionError；直接 target=concluded 一律拒绝）。
 * - linkHypothesis：采纳流程唯一的实验侧落盘（只写 hypothesis_id 链接字段，
 *   其余字段不改；同 id 幂等直返、不改时间戳；不同 id → HypothesisAdoptionError，
 *   绝不静默改链）。
 * - tenant 边界：define 遇 tenant 不一致、get/applyTransition/conclude/linkHypothesis
 *   命中他租户记录 → assertTenantScope InvariantViolation；未命中 →
 *   ExperimentNotFoundError（get 未命中 → null）；list* 只返回调用方租户的记录
 *   （mission_id 为 null 的实验永不匹配 mission 过滤）。
 */
export class ExperimentStore {
  private readonly directory: string;

  constructor(options: ExperimentStoreOptions) {
    this.directory = options.directory;
  }

  /** 定义实验（status=defined；结果字段全部不可表达——决策锁 #18）。 */
  define(
    tenantId: string,
    input: ExperimentInput,
    deps: ExperimentCreationDeps,
  ): Experiment {
    const normalized = this.parseOrFailAs(
      "ExperimentInput",
      experimentInputSchema,
      input,
    ) as ExperimentInput;
    const record = experimentFromInput(normalized, deps);
    assertTenantScope(record, { tenant_id: tenantId }, "experiment");
    this.persist(this.readAll(), record);
    return record;
  }

  /**
   * 读取单条实验：id 未命中任何记录 → null；
   * 命中他租户记录 → assertTenantScope InvariantViolation（跨租户访问显式拒绝）。
   */
  getExperiment(tenantId: string, experimentId: string): Experiment | null {
    const found = this.readAll().find((record) => record.id === experimentId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "experiment");
    return found;
  }

  /** 列出调用方租户的全部实验（其他租户的记录不可见）。 */
  listExperimentsByTenant(tenantId: string): readonly Experiment[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 列出调用方租户内挂在指定 mission 下的实验（mission_id 为 null 的实验永不匹配）。 */
  listExperimentsByMission(tenantId: string, missionId: string): readonly Experiment[] {
    return this.readAll().filter(
      (record) => record.tenant_id === tenantId && record.mission_id === missionId,
    );
  }

  /** 生命周期转移（domain 机器：跳态/回退/直接 concluded 一律具名拒绝）。 */
  applyTransition(
    tenantId: string,
    experimentId: string,
    transition: ExperimentTransitionInput,
    deps: ExperimentTransitionDeps,
  ): Experiment {
    const all = this.readAll();
    const current = this.findExperiment(all, tenantId, experimentId);
    const normalized = this.parseOrFailAs(
      "ExperimentTransition",
      experimentTransitionSchema,
      transition,
    ) as ExperimentTransitionInput;
    const next = applyExperimentTransition(current, normalized, deps);
    this.persist(all, next);
    return next;
  }

  /** 收尾（决策锁 #18 的唯一 outcome 写入路径；缺证据 → OutcomeEvidenceRequiredError）。 */
  conclude(
    tenantId: string,
    experimentId: string,
    input: ConcludeExperimentInput,
    deps: ExperimentTransitionDeps,
  ): Experiment {
    const all = this.readAll();
    const current = this.findExperiment(all, tenantId, experimentId);
    const normalized = this.parseOrFailAs(
      "ConcludeExperimentInput",
      concludeExperimentInputSchema,
      input,
    ) as ConcludeExperimentInput;
    const next = concludeExperiment(current, normalized, deps);
    this.persist(all, next);
    return next;
  }

  /**
   * 采纳流程的实验侧落盘：只写 hypothesis_id 链接（除此之外不记录任何假设数据）。
   * 同 id 幂等直返（不写入、不改时间戳）；不同 id 冲突 → HypothesisAdoptionError。
   */
  linkHypothesis(
    tenantId: string,
    experimentId: string,
    hypothesisId: string,
    deps: ExperimentTransitionDeps,
  ): Experiment {
    const all = this.readAll();
    const current = this.findExperiment(all, tenantId, experimentId);
    if (current.hypothesis_id === hypothesisId) {
      return current;
    }
    if (current.hypothesis_id !== null) {
      throw new HypothesisAdoptionError(
        "experiment_hypothesis_conflict",
        experimentId,
        hypothesisId,
        `实验已链接假设 ${current.hypothesis_id}（绝不静默改链）`,
      );
    }
    const next = parseOrFail(
      "Experiment",
      experimentSchema,
      {
        ...current,
        hypothesis_id: hypothesisId,
        updated_at: deps.now,
      },
    ) as Experiment;
    this.persist(all, next);
    return next;
  }

  /** 输入解析：shape 失败投影为类型化 ExperimentValidationError（fail-closed）。 */
  private parseOrFailAs(contract: string, schema: ZodType, input: unknown): unknown {
    try {
      return parseOrFail(contract, schema, input);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new ExperimentValidationError(error.issues);
      }
      throw error;
    }
  }

  /** 在已读集合中定位单条实验：未命中 → ExperimentNotFoundError；他租户记录 → InvariantViolation。 */
  private findExperiment(
    all: readonly Experiment[],
    tenantId: string,
    experimentId: string,
  ): Experiment {
    const found = all.find((record) => record.id === experimentId);
    if (found === undefined) {
      throw new ExperimentNotFoundError(tenantId, experimentId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "experiment");
    return found;
  }

  /** 落盘前统一守卫：schema + 不变量 §21（每条持久记录都过，defense in depth）。 */
  private persist(all: readonly Experiment[], record: Experiment): void {
    const validated = parseOrFail(
      "Experiment",
      experimentSchema,
      record,
    ) as Experiment;
    assertExperimentOutcomeEvidence(validated);
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
  private readAll(): readonly Experiment[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("ExperimentStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("ExperimentStore", [
        "存储文件结构必须是 { version, experiments }",
      ]);
    }
    const experiments = (parsed as { experiments?: unknown }).experiments;
    if (!Array.isArray(experiments)) {
      throw new ContractValidationError("ExperimentStore", [
        "存储文件缺少 experiments 数组",
      ]);
    }
    return experiments.map(
      (record) => parseOrFail("Experiment", experimentSchema, record) as Experiment,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(experiments: readonly Experiment[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, experiments }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
