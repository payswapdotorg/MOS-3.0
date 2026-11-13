/**
 * mos-commerce 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - registry 的 mos-integrations 依赖经组合根解析（情报证据引用 provider 读证据时，
 *   evidence_refs 只持不透明引用，绝不直接 import @mos/integrations）；
 * - artifact 血统只持不透明引用（W3 content-artifacts 由组合根解析）；
 * - 零 provider I/O、零支付/交易执行（定价只是记录与状态，执行归 Zcode runtime）。
 */
export const mosCommerceModule = {
  id: "mos-commerce",
  requires: ["mos-contracts"],
  provides: ["mos-commerce"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
