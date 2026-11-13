/**
 * mos-integrations 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 [mos-contracts, mos-identity-bridge, zcode-mos-adapters]：
 * - mos-contracts：连接/证据等契约 schema 与不变量守卫；
 * - mos-identity-bridge：tenant_id 只允许来自身份桥解析出的 TenantContext（组合根注入）；
 * - zcode-mos-adapters：ProviderPort / TimePort / 错误分类公共语言。
 * 本模块不拥有任何 ZCode 权威（plugin manifest、OAuth、凭据存储、工具执行均归 ZCode）。
 */
export const mosIntegrationsModule = {
  id: "mos-integrations",
  requires: ["mos-contracts", "mos-identity-bridge", "zcode-mos-adapters"],
  provides: [
    "mos-provider-descriptors",
    "mos-provider-connections",
    "mos-hubspot-read-adapter",
    "mos-composio-session-descriptor",
    "mos-connector-templates",
  ],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
