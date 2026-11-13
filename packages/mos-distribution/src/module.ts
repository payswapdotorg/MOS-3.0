/**
 * mos-distribution 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 *
 * requires 只有 mos-contracts（代码级依赖仅 @mos/contracts + zod + node 内建）：
 * - 共享契约：distributionIntentSchema（持久记录）、ExternalActionPreview 引用字段
 *   与 invariant 守卫（assertTenantScope / assertDistributionPreviewApproval）。
 * - 本模块绝无 provider I/O（决策锁 #8）：真正的 provider 发布/更新/删除
 *   归 Integration adapters，由组合根在 W1 缝上接线——execution_records 只是
 *   不透明 evidence 引用（决策锁 #19：Distribution 经 connectors 且仅在有权限后执行，
 *   权限审批绑定既有 ZCode 权限系统，决策锁 #6）。
 * - 本模块不 import @mos/integrations、@mos/content-artifacts、@mos/rights-policy
 *   或任何其他 @mos/* 包（跨模块记录访问经结构化端口/调用方提供的记录，
 *   rights/artifact 校验属各 authority 的写边界，接线归组合根）。
 */
export const mosDistributionModule = {
  id: "mos-distribution",
  requires: ["mos-contracts"],
  provides: ["mos-distribution"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
