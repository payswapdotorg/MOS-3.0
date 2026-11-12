# mos-identity-bridge CONTRACT

## Authority

- identity-mapping：把 ZCode 身份/工作区/会话事实映射为 MOS `TenantContext`（core-contracts §TenantContext）。
- 现有 ZCode 会话/身份体系仍是唯一权威；本模块只读事实（经 zcode-mos-adapters 的 `SessionFactsPort`）。

## Public entrypoints

- `@mos/identity-bridge` → `src/index.ts`
- `@mos/identity-bridge/contract` → `src/contract.ts`（`TenantResolution` / 不可用原因）

## 映射规则（fail-closed）

- `tenant_id` ← `workspaceKey`（ZCode 工作区隔离键：`workspaceIdentity?.trim() || workspacePath`）。
- `workspace_id` ← `projectId`（proj_*）；不可得时回退 `workspaceKey`。
- `actor_id` ← 登录用户 id；缺失 → `user_identity_missing`，绝不推断。
- `brand_id` ← null（W1 无品牌概念）。
- `source_zcode_session_id` / `source_zcode_task_id` ← 会话事实原样透传。
- 任何必需事实缺失 → `TenantResolution = { status: "unavailable", reason }`，不抛异常、不编造。
- 解析产物必须通过 `tenantContextSchema` 校验，否则 `tenant_context_invalid`。

## Layers

- `contract.ts`：解析结果类型。
- `domain/resolve-tenant.ts`：纯映射 + 不可用原因判定。
- `application/identity-bridge-service.ts`：经 `SessionFactsPort` 组装并校验。

## 消费方

mos-integrations、mos-missions（tenant 边界写入与 sidecar 关联都从这里取 tenant）。
