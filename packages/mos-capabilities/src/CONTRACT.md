# mos-capabilities CONTRACT

## Authority

- provider-integration-strategy-v3.0.md §2 第 4/5 层的 MOS 投影：能力描述符 schema、
  能力目录（capability + implementation 注册）、账户能力实例解析器。
- 本模块是"账户能力实例"的唯一判定 authority：某个 tenant 的连接到底能用什么能力，
  只由这里的 fail-closed 解析器说了算。描述符、插件元数据、商店安装状态都不是授权证据
  （strategy §3：The descriptor advertises possible mapping; account resolver determines
  actual capability instance. Never treat a descriptor as authorization.）。
- 不拥有任何 ZCode 权威：工具执行/权限/审批仍走既有 ZCode 边界
  （permissionMode 恒为 zcode_existing_permissions）。

## Public entrypoints

- `@mos/capabilities` → `src/index.ts`（描述符 schema、catalog、解析器、服务）
- `@mos/capabilities/contract` → `src/contract.ts`（类型窄口 + 类型化错误）

## Layers

- `contract/descriptor.ts`：§3 描述符 schema（id/version/capabilityId/providerId/integrationId/
  输入输出 schema/sideEffect/riskLevel/requiredScopes/requiredAccountTypes/requiredAppReview/
  permissionMode/evidenceSource/knownGaps/supportStatus/fallback/toolMapping）。
- `contract/resolver.ts`：解析输入契约 + 类型化错误
  （`CapabilityNotFoundError` / `ImplementationNotFoundError` / `ConnectionTenantMismatchError`）。
- `domain/resolve-instance.ts`：纯解析器 `resolveCapabilityInstance`（全部判定规则在此）。
- `application/catalog.ts`：`CapabilityCatalog`（注册时 schema 校验 fail-closed；
  descriptor 按 capabilityId 索引，implementation 按 id 索引，重复注册=替换）。
- `application/resolver-service.ts`：`CapabilityInstanceResolverService`
  （catalog + TimePort → 纯解析器；tenant 一致性与配对不变量在此守卫）。

## 判定规则（fail-closed，见 domain/resolve-instance.ts）

status 绝不为 "available"，除非同时满足：
1. `connection.status === "connected"`（实时连接检查）；
2. capability+implementation 的 required_scopes 并集全部被授予（`missingScopes` 精确集合差）；
3. `toolMappingVerified === true`（工具映射经 live server 核实；HubSpot 当前=false）；
4. `implementation.status === "available"`；
5. `implementation.evidence_refs` 非空（evidence-backed）。

缺口 → `missing_preconditions`（确定性顺序）：
- `connection:<status>`（expired/revoked/error/unknown）
- `tool_mapping_unverified`（同时把 support_status 降为 unknown）
- `scope:<missing-scope>`（逐个；此情形下 support_status 保持 supported——能力存在，账户缺 scope）
- `account_type:<current|unknown>`（描述符要求账户类型而连接不满足时）
- `implementation:<status>`（unavailable/unknown）
- `capability:status_unknown`（能力自身知识状态未知）
- `evidence:implementation_evidence_missing`（其余全满足但实现无证据 → 绝不 available）

其他语义：
- unsupported 与 unknown 是不同状态，绝不互相归并（§invariants 3）。
- `implementation.status === "degraded"` 且连接/scope/映射满足 → 实例 degraded。
- 实例 id 确定性（`ci:<tenant>:<capability>:<connection>`），重解析可对账。
- 全部输出过 `capabilityInstanceSchema` + `assertCapabilityInstanceAvailability`
  （available 必须有 liveConnectionChecked + requiredScopesCovered 支撑）。

## 状态（AGENTS.md §7 词汇）

- 解析器/目录：`contract-tested`（判定逻辑矩阵全覆盖；实例解析基于真实 provider 证据的
  live 验证 `blocked`——无 provider 测试账号，见 hubspot-connector-evidence.md）。

## 消费方

mos-routes（W1-C，路由候选评估）、组合根（TL 所有）。
