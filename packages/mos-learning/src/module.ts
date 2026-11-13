/**
 * mos-learning 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - 共享契约：calibrationRecordSchema（delayed_mode z.literal(true)——建议记录恒为
 *   延迟模式）；
 * - registry 的 mos-experiments 依赖经结构化 ExperimentLookup 端口满足（组合根把端口
 *   接到 @mos/experiments 的存储；与 mos-lab 消费 mission/route/offer 的 seam 一致）；
 *   本包绝不 import @mos/experiments。
 * - 不变量 §23：校准只引用 concluded 且带测量证据的实验；本包零执行/零修改 API——
 *   校准是建议记录，绝不直接改 routes/production（delayed-mode 安全位）。
 */
export const mosLearningModule = {
  id: "mos-learning",
  requires: ["mos-contracts"],
  provides: ["mos-learning"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
