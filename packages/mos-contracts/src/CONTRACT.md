# mos-contracts CONTRACT

## Authority

- 契约源头：`spec/contracts/core-contracts-v3.0.yaml`（TL 独占修订权，破坏性变更必须 bump 版本）。
- 本模块把该 YAML 投影为 zod schema + TypeScript 类型 + 运行时不变量守卫。
- 本模块不依赖任何 ZCode 包或其他 MOS 模块（`requires: []`）。

## Public entrypoints

- `@mos/contracts` → `src/index.ts`（完整公共 API：schema、类型、守卫、校验助手）
- `@mos/contracts/contract` → `src/contract.ts`（类型窄口 + 错误类型）

## Layers

- `contract/`：core-contracts-v3.0.yaml 的机读投影（enums、common 原语、11 个对象 schema）。
- `domain/`：§invariants 的运行时守卫。守卫在写边界调用，违规抛 `InvariantViolation`，绝不静默修正。
- `application/`：写边界统一校验 `parseOrFail`（fail-closed；解析失败抛 `ContractValidationError`）。

## 约定

- ids：opaque-stable-ids（非空字符串，调用方不得解析内部格式）。
- 时间戳：RFC3339-UTC（`Z` 结尾）。
- 金额：decimal-string-with-currency。
- 未知值：null + 显式 status，绝不猜值（守卫 `assertNoInferredMissionFields`）。
- 密钥：任何 provider 密钥只能以不透明 `credential_ref` 出现（守卫 `assertConnectionHoldsNoSecrets`）。
- 证据：外部事实必须 source + observed_at 齐备；simulation 不能存成 provider 观测。

## 不变量（spec YAML §invariants）

1. 缺少实时连接/scope 检查支撑的能力实例绝不 available（`assertCapabilityInstanceAvailability`）。
2. provider 静态描述符不是账户能力证据（由 capability resolver 承担，本模块提供守卫 1）。
3. unsupported 与 unknown 是不同状态（`assertDistinctSupportStates`）。
4. 每个有副作用的外部动作必须有预览并绑定既有 ZCode 权限审批（`assertExternalActionPreview`）。
5. 每个外部动作必须携带 tenant、connection、target、operation、side-effect、幂等/对账信息（同上）。
6. 每个观测事实必须有 source 与 observed_at；simulation 不能存成 provider 观测（`assertEvidenceProvenance`）。
7. Artifact 版本与父系血缘不可变（`assertArtifactLineageImmutability`）。
8. provider 密钥只能以不透明 credential_ref 表示（`assertConnectionHoldsNoSecrets`）。
9. 不得从营销简报推断缺失值（`assertNoInferredMissionFields`）。

## YAML 中标为 `enum` 的未命名字段

`auth_method`、`ProviderConnection.status`、`rights_status`、`quality_status` 在 YAML 中只写了
`enum` 未点名枚举；本模块按 additive 原则补齐命名枚举（`authMethodSchema` 等），并保留
`unknown` 等值以维持 fail-closed。后续 ACR 若点名枚举，按 additive-with-version-bump 对齐。

## 消费方

mos-identity-bridge、mos-integrations、mos-capabilities、mos-missions、mos-routes、
zcode-mos-adapters（port 类型复用契约原语时）。
