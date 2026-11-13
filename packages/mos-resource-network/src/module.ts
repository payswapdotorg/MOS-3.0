/**
 * mos-resource-network 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - registry 的 mos-agent-organizations / mos-capabilities 依赖经 OfferLookup / EngineLookup
 *   结构化端口在组合根解析（mos-lab OfferLookup 同一先例）；
 * - 节点/要约/引擎引用一律不透明 id 字符串，绝不 import 对方包（决策锁 #8/#9 投影）；
 * - 零 provider I/O、零 engine 调用、零执行器（gig 只承载 §8 任务包与路线比较记录）。
 */
export const mosResourceNetworkModule = {
  id: "mos-resource-network",
  requires: ["mos-contracts"],
  provides: ["mos-resource-network"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
