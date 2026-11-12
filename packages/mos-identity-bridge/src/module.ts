/**
 * mos-identity-bridge 模块登记（与 architecture-policy.yaml 互相校验）。
 */
export const mosIdentityBridgeModule = {
  id: "mos-identity-bridge",
  requires: ["mos-contracts", "zcode-mos-adapters"],
  provides: ["mos-tenant-context"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
