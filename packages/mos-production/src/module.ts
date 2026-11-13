/**
 * mos-production 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - mos-contracts：Transform / ProductionGraph / ProductionJob 契约与 invariant 守卫
 *   （assertTenantScope / assertJobNeverExecutes / assertGraphEngineRefsOpaque）；
 * - module-registry-v3.0.yaml 中 mos-production depends_on 的 mos-engines（transform/engine
 *   引用解析）与 mos-missions（mission_id 引用）全部经结构化 lookup 端口满足——
 *   transformLookup / engineLookup / graphLookup 由组合根注入接到对应模块的存储
 *   （与 mos-lab 消费 mission/route/offer 的 seam 方式一致）；
 *   本模块绝不 import @mos/engines、@mos/missions 或任何 zcode 包
 *   （决策锁 #5/#8/#9：无第二执行器、领域层零 provider I/O、零 engine 导入）。
 */
export const mosProductionModule = {
  id: "mos-production",
  requires: ["mos-contracts"],
  provides: ["mos-production"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
