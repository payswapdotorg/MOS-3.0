import type { Experiment, Hypothesis } from "@mos/contracts";

/**
 * 假设采纳缝（决策锁 #18 的 W3 写入权投影）：
 *
 * - @mos/lab 的 saveHypothesis 接受 adopted_by_experiment + experiment_ref 组合，
 *   且把该写入权保留给 W3（见其 CONTRACT.md「写入权也归 W3」）；
 *   本包通过**结构化端口**行使该写入权——本包绝不 import @mos/lab
 *   （模块依赖只有 @mos/contracts；接线归组合根）。
 * - 端口形状 = (tenantId, AdoptedHypothesis)：与 lab 的
 *   saveHypothesis(tenantId, hypothesis: Hypothesis) 输入形状结构一致
 *   （AdoptedHypothesis 是 Hypothesis 的收窄：status 字面量 adopted_by_experiment
 *   + 非空 experiment_ref——契约不变量 §15 允许的唯一携带实验引用的组合）。
 * - 端口可能抛错：抛错原样上抛（fail-closed，采纳不继续），绝不吞错、绝不重试。
 */

/** 采纳后的假设记录：status=adopted_by_experiment + 不透明 experiment_ref = experiment.id。 */
export type AdoptedHypothesis = Hypothesis & {
  readonly status: "adopted_by_experiment";
  readonly experiment_ref: string;
};

/**
 * HypothesisUpdatePort —— 结构化写端口（组合根把它映射到 @mos/lab 的 saveHypothesis；
 * 本包只依赖该形状，不依赖 lab 的实现）。返回值不约束（lab 返回保存后的记录，
 * 端口消费者自行决定是否使用）。
 */
export type HypothesisUpdatePort = (
  tenantId: string,
  hypothesis: AdoptedHypothesis,
) => unknown;

/** 采纳服务输入：目标实验 id + 当前假设记录（由调用方/组合根提供——本包不经端口读 lab）。 */
export interface AdoptHypothesisInput {
  readonly experimentId: string;
  readonly hypothesis: Hypothesis;
}

/** 采纳的注入依赖：时间由调用方提供（领域层零 Date/random 依赖）。 */
export interface AdoptionDeps {
  readonly now: string;
}

/** 采纳流程只读实验记录的这些字段（其余字段不参与判定）。 */
export type AdoptionExperimentView = Pick<
  Experiment,
  "id" | "tenant_id" | "mission_id" | "status"
>;
