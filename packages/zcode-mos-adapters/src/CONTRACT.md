# zcode-mos-adapters CONTRACT

## Authority

- MOS 底物端口层：把 MOS 与 ZCode 底层的耦合收敛到"端口定义 + 纯函数"。
- 生产源码零 ZCode 导入（结构化注入）：组合根负责把 `ProviderPort`/`SessionFactsPort`
  适配到真实 ZCode MCP 客户端栈与会话/身份服务。MOS 不建第二权限系统、第二工具注册表。
- 本模块不拥有任何 ZCode 权威（module-registry: authority = adapters-only）。

## Public entrypoints

- `@mos/adapters` → `src/index.ts`（端口 + 纯函数 + 测试替身）
- `@mos/adapters/contract` → `src/contract.ts`（端口类型窄口）

## Layers

- `contract/`：
  - `provider-port.ts`：`ProviderPort`（connectServer/listTools/callTool/status/close），
    形状贴近 ZCode `McpPort` 最小子集，便于组合根适配。
  - `provider-errors.ts`：错误分类公共语言（unauthorized/insufficient_scope/wrong_account/
    rate_limited/provider_outage/tool_not_found/invalid_input/protocol_error/unknown）+
    `providerErrorAction`（invalidate_instance / backoff_and_surface / fail_closed）。
  - `session-port.ts`：`SessionFactsPort`（只读会话/身份事实 + 任务创建观察）、`TimePort`。
- `domain/`：`tool-name.ts`（mcp__server__tool 合成/解析/精确匹配）、
  `provider-error-classification.ts`（负向矩阵模式匹配 + 消息脱敏 + scope 覆盖差集）。
  全部纯函数，fail-closed：无法识别 → unknown。
- `application/`：`InMemoryProviderPort`、`InMemorySessionFactsPort`、`SystemTimePort`、
  `workspaceFactsFromPath`（contract-only 替身；不得作为生产连通性证据）。

## 约束

- 分类只输出已脱敏 message；任何令牌/令牌形状字符串都会被 `redactProviderMessage` 去除。
- `missingScopes` 精确集合差，无通配符、无前缀推断。
- `requires: [zcode-cli]` 只由集成测试贡献（真实 MCP 客户端栈 + 真实凭据存储）；
  生产源码不 import `apps/zcode-cli/**`。

## 消费方

mos-identity-bridge、mos-integrations、mos-missions（均经组合根注入端口实例）。
