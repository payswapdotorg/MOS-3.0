/**
 * mos-contracts 模块登记（architecture-policy.yaml 与本声明必须互相校验）。
 * requires 为空：契约层只依赖 zod，不依赖任何 ZCode 或其他 MOS 模块。
 */
export const mosContractsModule = {
  id: "mos-contracts",
  requires: [],
  provides: ["mos-contracts"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
