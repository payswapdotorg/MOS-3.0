/**
 * mos-rights-policy 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 ["mos-contracts"]（W3-A 决议）：
 * - mos-contracts：RightsRecord 契约（rightsRecordSchema）、不变量守卫
 *   （assertRightsClearedForUse / assertTenantScope）与 parseOrFail。
 * - registry 中 mos-rights-policy depends_on 的 mos-content-artifacts /
 *   mos-identity-bridge 经组合根结构性满足：artifact 引用是不透明字符串
 *   （subject_artifact_ref），本包不导入 @mos/content-artifacts——权利记录的
 *   artifact 引用存在性解析归组合根（artifactLookup 接线属后续阶段）。
 */
export const mosRightsPolicyModule = {
  id: "mos-rights-policy",
  requires: ["mos-contracts"],
  provides: ["mos-rights-policy"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
