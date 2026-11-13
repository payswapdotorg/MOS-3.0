# mos-integrations CONTRACT

## Authority

- provider-integration-strategy-v3.0.md §2 第 2/3 层的 MOS 投影：ZCode connector 模板声明 +
  provider 描述符 + 连接元数据 + 一条 provider-neutral 读适配器。
- 本模块不拥有任何 ZCode 权威：plugin.json manifest schema、插件安装/启用/市场、OAuth、
  凭据存储、工具执行、权限边界全部归既有 ZCode（strategy §4）。MOS 不建第二凭据系统、
  第二权限系统、第二工具注册表。
- 账户能力判定不归本模块：实例解析在 mos-capabilities。本模块的描述符只是
  "可能存在的映射"，绝不构成账户授权证据。

## Public entrypoints

- `@mos/integrations` → `src/index.ts`（描述符、connector 模板加载器、连接存储、读适配器，
  以及消费方需要的窄转发接缝：`missingScopes`、`TimePort`/`SystemTimePort`——
  registry 规定下游只依赖本包，不直接依赖 zcode-mos-adapters）
- `@mos/integrations/contract` → `src/contract.ts`（类型窄口 + `ConnectionNotFoundError`）

## Layers

- `contract/hubspot-descriptor.ts`：版本化 provider 描述符 schema + HubSpot 官方远程 MCP
  纯数据声明（endpoint/authMethod/officialDocs/status/toolMappingVerified）。
- `contract/composio-descriptor.ts`（W2）：同一 schema 的 Composio 数据声明 —— hosted
  session MCP（REST session 工厂逐会话签发 mcp.url，`x-api-key` header 授权，
  auth_method=api_key），toolMappingVerified=true 由 live 观测支撑（evidence 记录 §4/§6）；
  另有 session 工厂请求/响应最小 schema（composioSessionRequest/ResponseSchema）。
- `contract/read-adapter.ts`：读查询/结果契约 + 类型化错误。
- `connector/hubspot-connector-template/`：可安装 connector 的 `.zcode-plugin/plugin.json`
  模板（只使用 ZCode manifest 既有字段；NOT wired，组合根后续决定是否安装）。
- `connector/hubspot-connector-declaration.ts`：模板加载器（zod 结构校验 + manifest 字段
  白名单 fail-closed + 与 provider 描述符一致性校验）。
- `domain/read-summary.ts`：provider 结果 → 计数/形状摘要（纯函数；未知→null，不猜值）。
- `application/connection-store.ts`：tenant-scoped 连接存储（JSON 文件、原子写）。
- `application/read-adapter.ts`：HubSpotReadAdapter（ProviderPort 注入，错误走公共语言）。

## 硬规则（fail-closed）

- 密钥：连接记录只允许持有指向 ZCode 凭据存储的不透明 `credential_ref`
  （形如 `mcp:oauth:<24hex>`）。写路径 = 未知字段白名单拒绝 + `providerConnectionUpsertSchema`
  校验 + `assertConnectionHoldsNoSecrets` 守卫；读路径对每条记录再跑一次守卫。
- Tenant 隔离：`tenant_id` 只来自方法参数（组合根经 mos-identity-bridge 解析注入），
  所有读写按 tenant 过滤；跨 tenant 永远查不到。
- 工具名：HubSpot MCP 工具名在本环境 UNVERIFIED（无 provider 账号/OAuth client）。
  `toolMappingVerified=false` → 能力解析只能得到 unknown/unavailable，绝不 available。
  Composio 例外（W2）：session MCP 的 meta-tool 名与 HACKERNEWS_SEARCH_POSTS 读路径经
  live 核实（composio-connector-evidence.md），`toolMappingVerified=true` 仅对该 provider
  成立，授权材料仍只存不透明 credential_ref。
- 证据：读成功只产出 `Evidence`（kind=provider_response，source 含 observed_via/tool/
  connection_id，observed_at 经 TimePort）；facts 只含计数与形状，原始负载绝不内嵌。
- 错误：provider 失败 → `classifyProviderError` → `providerErrorAction`；
  unauthorized/insufficient_scope/wrong_account → `invalidate_instance`；
  rate_limited/provider_outage → `backoff_and_surface`；其余 → `fail_closed`。
  不重试、不吞错、不换 tenant。

## 状态（AGENTS.md §7 词汇）

- HubSpot connector：`planned-live-read`。工具名映射 `contract-tested`（stand-in 替身 +
  真实 ZCode MCP 客户端栈契约测试，见 zcode-mos-adapters test/integration）。
  live 读 `blocked`（无 provider 测试账号）；证据记录见
  `spec/integrations/provider-evidence/hubspot-connector-evidence.md`。

## 消费方

mos-capabilities（capability descriptor/catalog/实例解析基于这里的连接与描述符事实）、
组合根（TL 所有；安装 connector 模板、注入 ProviderPort/TimePort、接线 identity-bridge）。
