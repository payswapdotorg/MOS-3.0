/**
 * mos-content-artifacts 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 ["mos-contracts"]（W3-A 决议）：
 * - mos-contracts：Artifact 契约（artifactSchema）、不变量守卫
 *   （assertArtifactLineageImmutability / assertTenantScope）与 parseOrFail。
 * - registry 中 mos-content-artifacts depends_on 的 mos-identity-bridge 经组合根
 *   结构性满足（tenant 上下文由调用方注入，本包不导入 identity 模块）。
 * - content 引用一律不透明字符串（content_ref / parent_artifact_refs），
 *   本包永不保存内容字节；与 transform/engine 记录（mos-production / mos-engines）
 *   零导入（决策锁 #9：领域层零 engine 导入）。
 */
export const mosContentArtifactsModule = {
  id: "mos-content-artifacts",
  requires: ["mos-contracts"],
  provides: ["mos-content-artifacts"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
