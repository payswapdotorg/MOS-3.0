# Start Plan Product Scope（产品范围身份）

## 背景

MOS 是从 ZCode 代码库衍生的独立分发产品（独立 app id `org.payswap.mos`、独立数据根
`~/.mos`、独立安装包），但 Start Plan（免费模型额度）的计费/权益链路与 ZCode 完全共享：
同一批 endpoint、同一个 claim 请求体、缓存键没有产品维度。产品要求（ACR-0001 /
`docs/handoff/TL-HANDOFF-PRODUCT-SCOPED-START-PLAN.md`）是 **每个已注册产品一份独立的
免费权益**：同一账号可同时持有 ZCode 与 MOS 各自的免费配额，互不消耗；重装、换设备、
改版本都不得再得一份新 grant。

## 三个身份轴（不要混淆）

| 轴 | 例子 | 生命周期所有者 | 作用 |
|---|---|---|---|
| API 产品身份 | `zcode` / `mos`（`X-ZCode-Product-Id`） | 构建期 composition（product flavor define 派生） | 计费/权益的产品范围 |
| 桌面打包身份 | `org.payswap.mos` / `dev.zcode.app` | electron-builder / `MOS_PRODUCT_IDENTITY` | 安装包、数据目录、AUMID |
| 设备身份 | `X-Device-Mid`（telemetry-state.json） | telemetry 生命周期 | 设备维度对齐（见 `docs/zcode-endpoint-device-mid-header.md`） |

产品身份 **不是** 设备身份，也 **不是** 打包身份；`X-Device-Mid` 不承担产品范围职责。

## 设计

- 产品 id 集中定义在 `packages/shared/src/env.ts`：`ZCodeProductId = "zcode" | "mos"`，
  由构建期 `__ZCODE_PRODUCT_FLAVOR__`（`mos` flavor → `mos`，其余/未注入 → `zcode`）派生，
  导出 `ZCODE_PRODUCT_ID`。渲染层表单、用户偏好、任意运行时 env 都不能选择它 —— 只有
  可信构建 composition 能（新增衍生产品 = 注册 id + flavor 映射，无需改写订阅服务）。
- 请求面：`buildZCodeSourceHeadersFromContext()` 统一输出
  `X-ZCode-Product-Id: <当前产品>`，经 `NodeApiClient` 的 endpoint 来源头注入覆盖
  `client/configs`、`billing/preview`、`billing/claim`、`billing/balance` 等全部 ZCode
  endpoint 请求；claim 请求体在 **非默认产品**（`mos`）时额外携带 `product_id`
  （`zcode` 请求体与现状字节一致，零回归；服务端迁移语义：缺省 `product_id` ⇒ `zcode`）。
- 模型面：`buildStartPlanAccountRequestAuthMaterial()` 让 Start Plan 的
  provider-runtime-headers 材料携带产品头，`applyModelRequestAuth` 合入模型请求 ——
  zcode-plan 网关据此把用量 debits 记入正确产品的配额。
- 响应面（fail-closed，`isStartPlanRecordOwnedByCurrentProduct` 单一裁决）：
  - 声明了归属产品（`productId` / `product_id`）⇒ 必须与当前产品一致才算本产品记录；
    未知/他产品 id 一律拒绝。
  - 未声明归属（旧后端共享配置）⇒ 只有默认产品 `zcode` 可消费；`mos` 不得因 zcode
    预览存在而推断自己有 grant（当前生产后端下 MOS 的 Start Plan 显示为不可用 —— 这是
    刻意的，不是缺陷）。
- 缓存面：client/configs 快照键、balance 去重键、渲染层 localStorage 权益缓存键
  （`zcode:usage-entitlement:subscription-v2:<productId>:<providerId>:<fingerprint>`）与
  Start Plan 预览缓存（按 service 实例 + 产品）都含产品维度；跨产品永不互读。
- 权益裁决不变：客户端不落地 grant 记录，权益始终由 `billing/balance` 重新推导 ——
  重装 MOS 自然找回既有 grant，不会也不可能在本地“续命”出新试用。

## 覆盖范围

请求头覆盖所有走 `NodeApiClient` 的 ZCode endpoint 请求与 Start Plan 模型面请求。
服务端（Z.AI/BigModel 所有）的产品目录注册、`(user, product, plan)` 粒度 grant、幂等
并发领取与按产品 debits 见配对手册
`docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md` —— 后端上线前客户端 fail-closed，
不展示也不消耗任何 MOS 权益，对现有 ZCode 用户零影响。

## 证据

- 合同测试：`packages/services/test/codingPlanProductScope.test.ts`（真实本地
  product-aware mock 后端 + 真实 `NodeApiClient`：产品矩阵、claim 体/头、balance 过滤、
  缓存隔离、fail-closed）与 `packages/ui/test/usageEntitlementProductScope.test.ts`。
- 决策记录：`spec/decisions/ACR-0001-product-scoped-start-plan.md`；客户端/服务端所有权
  审计：`docs/handoff/START-PLAN-SOURCE-AUDIT.md`。
