/**
 * mos-missions 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 必须与 module-registry-v3.0.yaml 的 depends_on 完全一致：
 * mos-contracts、mos-identity-bridge（tenant 边界解析）、zcode-mos-adapters（底物端口）。
 */
export const mosMissionsModule = {
  id: "mos-missions",
  requires: ["mos-contracts", "mos-identity-bridge", "zcode-mos-adapters"],
  provides: ["mos-missions"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
