/**
 * mos-agent-organizations 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 ["mos-contracts"]（W2-A 决议）：
 * - mos-contracts：AgentBody / Organization / NodeOffer 契约、NODE_OFFER_REQUIRED_DISCLOSURES
 *   与 invariant 守卫（assertTenantScope / assertNodeOfferPublishable）。
 * - capability 引用一律使用不透明 id 字符串（capability_id），不直接依赖 @mos/capabilities
 *   （module-registry depends_on 的对账与 gate wiring 归 TL 所有）。
 */
export const mosAgentOrganizationsModule = {
  id: "mos-agent-organizations",
  requires: ["mos-contracts"],
  provides: ["mos-agent-bodies", "mos-organizations", "mos-node-offers"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
