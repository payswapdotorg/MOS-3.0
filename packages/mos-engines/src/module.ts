/**
 * mos-engines 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - mos-contracts：Engine 契约（engineSchema）与 invariant 守卫（assertTenantScope）。
 * - 决策锁 #9：本包只有 engine 注册表 + 沙箱策略【描述符】——没有 engine 导入、
 *   没有任何调用/执行路径；被选中的 engine 由组合根经沙箱适配器调用
 *   （module-registry depends_on 的对账与 gate wiring 归 TL 所有）。
 */
export const mosEnginesModule = {
  id: "mos-engines",
  requires: ["mos-contracts"],
  provides: ["mos-engines"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
