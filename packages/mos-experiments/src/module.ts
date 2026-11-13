/**
 * mos-experiments 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - 共享契约：experimentSchema（持久记录）、Hypothesis（采纳记录的形状——经结构化端口
 *   写回 @mos/lab，本包不 import lab）与 invariant 守卫
 *   （assertTenantScope / assertExperimentOutcomeEvidence / assertHypothesisCarriesNoOutcome）。
 * - 决策锁 #18：本模块是 Experiment authority —— 实验定义、指派、测量证据引用与
 *   **结果**（outcome）的唯一写入方；Lab simulation 不是实验（lab 只提假设）。
 *   假设采纳（adopted_by_experiment + experiment_ref）经注入的 HypothesisUpdatePort
 *   写回 lab 的 saveHypothesis（W2 为 W3 保留的写入权）；组合根负责把端口接到
 *   @mos/lab —— 本模块绝不 import @mos/lab（与 mos-lab 消费 mission/route/offer 的
 *   lookup 端口 seam 方式一致）。
 * - 决策锁 #8：零 provider I/O —— measurement_evidence_refs 只是不透明证据引用，
 *   测量/观测经组合根（Integration adapters 之外的真实世界观测）回填。
 */
export const mosExperimentsModule = {
  id: "mos-experiments",
  requires: ["mos-contracts"],
  provides: ["mos-experiments"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
