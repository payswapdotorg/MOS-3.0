/**
 * mos-routes 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 [mos-contracts, mos-capabilities, mos-missions]（registry 决议）：
 * - mos-contracts：Route/CapabilityInstance/Mission 契约 + 校验/不变量守卫；
 * - mos-capabilities：账户能力实例（路由评估的输入事实；TimePort 经其 contract 窄转发）；
 * - mos-missions：mission 聚合（路由候选挂接的对象；组合根负责把二者配对）。
 * 本模块是 W1 路由候选评估的 authority：existing/conditional/blocked/unknown 的
 * fail-closed 判定只由这里做出；工具执行与权限审批仍走既有 ZCode 边界。
 */
export const mosRoutesModule = {
  id: "mos-routes",
  requires: ["mos-contracts", "mos-capabilities", "mos-missions"],
  provides: ["mos-routes"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
