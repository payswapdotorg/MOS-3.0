import { assertTenantScope, hypothesisSchema, parseOrFail } from "@mos/contracts";
import type { Hypothesis } from "@mos/contracts";
import type {
  AdoptHypothesisInput,
  AdoptionDeps,
  HypothesisUpdatePort,
} from "../contract/adoption.js";
import type { AdoptedHypothesis } from "../contract/adoption.js";
import { buildAdoption } from "../domain/adoption.js";
import { ExperimentNotFoundError, HypothesisAdoptionError } from "../contract/experiment.js";
import type { ExperimentStore } from "./experiment-store.js";

export interface AdoptionServiceOptions {
  /** 实验存储（本包 authority；采纳只落实验侧 hypothesis_id 链接）。 */
  readonly store: ExperimentStore;
  /**
   * HypothesisUpdatePort —— 结构化写端口（组合根映射到 @mos/lab 的 saveHypothesis；
   * 本包绝不 import @mos/lab）。端口可能抛错：抛错原样上抛，采纳不继续（fail-closed）。
   */
  readonly hypothesisUpdate: HypothesisUpdatePort;
}

/**
 * 假设采纳服务（决策锁 #18：adopted_by_experiment + experiment_ref 的写入权归本包）。
 *
 * 流程（全部校验先于副作用，fail-closed）：
 * 1. 读取实验（未命中 → ExperimentNotFoundError；他租户 → InvariantViolation——
 *    store 的 getExperiment/findExperiment 已守卫）；
 * 2. 校验调用方提供的当前假设记录：hypothesisSchema fail-closed +
 *    assertTenantScope（与调用方租户一致）；实验已链接其他假设 →
 *    HypothesisAdoptionError(experiment_hypothesis_conflict)（绝不静默改链）；
 * 3. buildAdoption 领域判定（同租户一致性 / 实验状态 / mission 匹配 / 假设状态）；
 * 4. 调用注入端口持久化采纳记录（端口抛错原样上抛——采纳不继续）；
 * 5. 端口成功后，把 hypothesis.id 链接落盘到实验的 hypothesis_id 字段
 *    （**除此之外不记录任何假设数据**——不复制 statement/evidence/…）。
 *
 * 已知限制（显式）：端口与实验存储之间无跨存储事务——端口成功而链接落盘失败时
 * 假设已采纳但实验未记录链接（错误具名上抛，对账归组合根；单进程顺序调用下不可达，
 * 见 CONTRACT.md「已知限制」）。
 */
export class AdoptionService {
  private readonly store: ExperimentStore;
  private readonly hypothesisUpdate: HypothesisUpdatePort;

  constructor(options: AdoptionServiceOptions) {
    this.store = options.store;
    this.hypothesisUpdate = options.hypothesisUpdate;
  }

  /**
   * 采纳假设：输入 = 目标实验 id + **当前**假设记录（由调用方/组合根提供——
   * 本包不经任何端口读 lab；过期的假设记录由领域状态判定拦截）。
   */
  adoptHypothesis(
    tenantId: string,
    input: AdoptHypothesisInput,
    deps: AdoptionDeps,
  ): AdoptedHypothesis {
    const experiment = this.store.getExperiment(tenantId, input.experimentId);
    if (experiment === null) {
      throw new ExperimentNotFoundError(tenantId, input.experimentId);
    }

    const hypothesis = parseOrFail(
      "Hypothesis",
      hypothesisSchema,
      input.hypothesis,
    ) as Hypothesis;
    assertTenantScope(hypothesis, { tenant_id: tenantId }, "hypothesis");

    if (experiment.hypothesis_id !== null && experiment.hypothesis_id !== hypothesis.id) {
      throw new HypothesisAdoptionError(
        "experiment_hypothesis_conflict",
        experiment.id,
        hypothesis.id,
        `实验已链接假设 ${experiment.hypothesis_id}（绝不静默改链）`,
      );
    }

    const adopted = buildAdoption(experiment, hypothesis, deps);
    // 写端口先于实验侧链接落盘：端口拒绝 → 采纳不继续（fail-closed，错误原样上抛）。
    this.hypothesisUpdate(tenantId, adopted);
    this.store.linkHypothesis(tenantId, experiment.id, hypothesis.id, deps);
    return adopted;
  }
}
