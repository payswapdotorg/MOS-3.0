/**
 * mos-capabilities 模块登记（与 architecture-policy.yaml / module-registry-v3.0.yaml 互相校验）。
 * requires 固定为 [mos-contracts, mos-integrations]（registry 决议）：
 * - mos-contracts：Capability/ProviderImplementation/CapabilityInstance 契约 + 不变量守卫；
 * - mos-integrations：连接事实与 provider 描述符；底物接缝（scope 覆盖、TimePort）
 *   经 integrations 窄转发，本模块不直接依赖 zcode-mos-adapters。
 * 本模块是"账户能力实例"的唯一 authority：能力是否可用只由这里 fail-closed 判定，
 * 描述符/插件元数据不是账户授权证据（strategy §3）。
 */
export const mosCapabilitiesModule = {
  id: "mos-capabilities",
  requires: ["mos-contracts", "mos-integrations"],
  provides: [
    "mos-capability-descriptors",
    "mos-capability-catalog",
    "mos-capability-instances",
  ],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
