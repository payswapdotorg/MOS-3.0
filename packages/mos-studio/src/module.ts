/**
 * mos-studio 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 必须与两处登记完全一致：
 * - mos-* 域模块（组合根实际接线的全部 authority）；
 * - zcode-mos-adapters（底物端口；registry id zcode-substrate-adapters，映射见 registry 头注）；
 * - zcode-cli（真实栈组合：src/runtime 经 @zcode/adapters 使用真实 ZCode MCP 客户端与
 *   真实共享加密凭据存储 —— 仅组合根合法，默认 typecheck 排除 src/runtime，见 CONTRACT.md）。
 */
export const mosStudioModule = {
  id: "mos-studio",
  requires: [
    "mos-contracts",
    "mos-identity-bridge",
    "mos-missions",
    "mos-integrations",
    "mos-capabilities",
    "mos-routes",
    "zcode-mos-adapters",
    "zcode-cli",
  ],
  provides: ["mos-studio"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
