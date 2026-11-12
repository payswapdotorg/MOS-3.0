# mos-routes CONTRACT

## Authority

- route-planning（module-registry-v3.0.yaml）：路由候选、前提、对比与回退评估的 authority。
- W1 范围是最小 fail-closed 候选评估器（FINAL-TL-HANDOFF-WEEK-1.md §6C："Do not build the
  full general planner in Week 1; implement the minimum resolver to demonstrate honest
  states and prerequisites."）。
- 不拥有执行/权限/审批：工具执行与审批仍走既有 ZCode 边界；approvals 只绑定
  `zcode_existing_permissions`（与 @mos/capabilities 描述符 permissionMode 同值），
  MOS 绝不建第二权限系统。

## Public entrypoints

- `@mos/routes` → `src/index.ts`
- `@mos/routes/contract` → `src/contract.ts`（类型窄口 + 错误再导出）

## 评估输入（contract/route-input.ts）

- `RouteInstanceFact = { instance: CapabilityInstance, side_effect: SideEffect }`：
  已解析的账户能力实例 + 描述符声明的副作用。副作用由组合根从描述符配对带来；
  路由评估绝不从 capability_id/implementation_id 猜副作用（fail-closed：不知道就是
  `"unknown"`，由调用方如实标注）。
- `now`：RFC3339 UTC 评估时间锚点（经 TimePort 获得；W1 Route 无时间戳字段，先守纪律）。
- `idSeed`：正整数；route id = `route:<mission_id>:<seed>:<position>`，
  同一 (mission, seed) 重评估产生相同 id（重评估可对账）。
- 实例 tenant 与 mission tenant 不一致 → `InvariantViolation`（fail-closed）。

## 分类规则（domain/evaluate-route.ts，first-match；判据全部来自输入事实）

1. `side_effect "irreversible"` → **blocked**（W1 无 irreversible 审批路径；
   risks `side_effect:irreversible`；即使实例 available 也绝不 existing）。
2. `support_status "unsupported"` → **blocked**（terminal 知识状态，前提永远补不齐；
   risks `support_status:unsupported`）。
3. `support_status "unknown"` 或 `instance.status "unknown"` → **unknown**
   （unknowns 抄录实例 missing_preconditions；实例未披露时用显式 floor 标记
   `support_status:unknown` / `instance_status:unknown`）。
4. `instance.status "available"` → **existing**（preconditions []；side_effect 非
   none/read（含 unknown）→ approvals `["zcode_existing_permissions"]`）。
5. `instance.status "unavailable"` + missing_preconditions → **conditional**
   （preconditions 逐字抄录：never invented, never dropped）；
   unavailable 但未披露前提 → **unknown**（`instance_status:unavailable_no_preconditions_disclosed`）。
6. `instance.status "degraded"` → **conditional**（preconditions 逐字抄录；
   risks `implementation:degraded`）。

其他不变量：

- 无任何实例 → 单条 **unknown** 路由，unknowns 恒 `["no_capability_instances_resolved"]`
  （绝不 blocked、绝不 existing）。
- `status` 恒 `candidate`；`fallback_route_ids` 恒 `[]`（W1 无静默回退）。
- `estimated_cost` / `estimated_latency_ms` / `confidence` 恒 null（绝不知情猜测）。
- steps 如实披露动作（能力 + 副作用 + 实例引用），无发明的营销话术。
- 每条产物经 `routeSchema` parseOrFail（fail-closed）。

## 对比（domain/evaluate-route.ts `compareRoutes`）

五个 route_class 全部可区分计数（W1 评估器不产 opportunity_constrained，恒 0）。

## Layers

- `contract/route-input.ts`：输入/产物契约 schema + 类型。
- `contract/route-vocabulary.ts`：candidate 状态、权限绑定名、no-instances 标记。
- `domain/evaluate-route.ts`：纯评估器 + 对比（零 I/O、零 Date/random）。
- `application/route-service.ts`：`RouteService({time})` 薄封装（时钟注入 + 逐条复验）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：分类/对比/校验矩阵经契约测试覆盖；
  与真实 mission store、能力解析器和 New Task UI 的挂接属组合根阶段（deferred）。

## 消费方

- 组合根（TL 所有；mission × capability facts 配对在此发生）、mos-lab（week-2）。
