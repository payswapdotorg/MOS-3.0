# mos-missions CONTRACT

## Authority

- missions（module-registry-v3.0.yaml）：Mission/objective intake 与 ZCode 会话/任务关联的唯一 authority。
- 逐字 intake：objective 一律按用户原话逐字保存（core-contracts §Mission + invariant §9：绝不错误推断缺失值）。
- ZCode 会话/任务体系仍是消息与通用任务状态的唯一权威（AGENTS.md §2 / preservation contract）；
  Mission 只保留可空引用（source_zcode_session_id / source_zcode_task_id），绝不复制会话内容。

## Public entrypoints

- `@mos/missions` → `src/index.ts`
- `@mos/missions/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明方法）

## Intake 规则（domain/intake.ts，纯函数、零 I/O）

- objective ← objective_verbatim 逐字（标点/大小写/空白原样）；空白 objective 违规（InvariantViolation）。
- target_audience / geography / budget / deadline：未提供保持 null；空串违规（缺失值必须是 null 而不是空串）。
- desired_outcomes / success_metrics：与调用方完全一致（未提供 = []）。
- constraints 恒为 {}（intake 契约无此字段，绝不发明）。
- status = active（W1 词表，见 contract/mission-vocabulary.ts）；id / created_at / updated_at 由注入 deps 提供。
- 产物双向守卫：missionSchema + assertNoInferredMissionFields。

## MissionStore（application/mission-store.ts）

- 文件后端：注入目录下单文件 mos-missions.json；原子写（同目录 tmp + rename）；文件缺失 → 空启动。
- tenant-scoped：所有方法以调用方传入的 tenant_id 为准；跨 tenant 记录不可见；
  mission.tenant_id 与调用方不一致 → fail-closed 抛 ContractValidationError。
- 事件：首次保存 mission.created；关联真实变化 mission.linked（幂等关联不写不发）；
  事件先经 domainEventSchema 校验再交注入 eventSink（append-only 语义由监听方承担）。
- 读取容忍未知键（additive 演化）；结构/JSON 损坏 fail-closed 抛 ContractValidationError。

## MissionSidecarService（application/mission-sidecar.ts，graceful failure）

- attachToSessionFacts({sessionFacts, identityBridge, store, time}) → {dispose()}；
  observeTaskCreated 缺席 → 空句柄（sidecar 缺席，标准任务路径不受影响）。
- 任务创建事实 → 解析 tenant；不可解析 → 静默缺席 + lastErrors 记录原因（绝不抛入 ZCode 任务路径）。
- objective_verbatim 只用事件事实（"[mos] Mission sidecar for task <taskId>"）；
  真实目标由后续组合层补充（deferred composition，绝不编造营销内容）。
- intake 直接携带事件事实的 source_zcode_session_id / source_zcode_task_id（可空关联只存引用）。
- 幂等：(tenant, source_zcode_session_id) 已有 mission → 复用，不重复创建。
- 一切异常按 stage（resolve_tenant / find_existing_mission / persist_mission / link_session）
  收集进 lastErrors（只读暴露），绝不向上抛出。

## Layers

- `contract.ts` / `contract/mission-vocabulary.ts`：类型与词表（无方法声明）。
- `domain/intake.ts`：纯 intake（零 I/O、零 Date/random；now/id 注入）。
- `application/*`：文件持久化 + sidecar 订阅（node:fs / node:crypto 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：intake/store/sidecar 行为经契约测试覆盖；
  与真实 ZCode New Task/UI 事件的挂接属组合根阶段（deferred）。

## 消费方

- mos-routes（mission 聚合输入）、组合根（TL 所有；sidecar 挂接与事件流落地）。
