/**
 * mos-lab 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * module-registry-v3.0.yaml 中 mos-lab depends_on 的 mos-missions / mos-capabilities /
 * mos-routes（以及 W2-A 的 mos-agent-organizations）全部经结构化 lookup 端口满足——
 * missionLookup / hypothesisLookup / routeLookup / offerLookup / evidenceLookup 由
 * 组合根注入接到对应模块的存储（与 mos-routes 消费能力实例的 seam 方式一致：
 * 见其 CONTRACT.md「评估输入」——副作用由组合根从描述符配对带来）。
 * 本模块绝不 import @mos/missions、@mos/capabilities、@mos/routes、
 * @mos/agent-organizations 或任何 zcode 包（决策锁 #8/#9：领域层零 provider I/O、
 * 零 engine 导入）。
 */
export const mosLabModule = {
  id: "mos-lab",
  requires: ["mos-contracts"],
  provides: ["mos-lab"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
