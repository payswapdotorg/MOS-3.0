# mos-distribution CONTRACT

## Authority

- distribution（module-registry-v3.0.yaml）：Provider 发布/更新/删除**意图**（DistributionIntent）、
  预览绑定（preview_ref + preview_hash）、审批绑定与执行记录（evidence refs）的唯一 authority。
- 决策锁 #8：本包**零 provider I/O** —— publish/update/delete 只是意图记录；真正的 provider 调用
  归 Integration adapters，由组合根在 W1 缝上接线（决策锁 #19：Distribution 经 connectors 执行、
  且仅在有权限后；权限审批绑定既有 ZCode 权限系统，决策锁 #6）。本包的 execution_records
  **只是 evidence 引用**（append-only 不透明字符串），绝不包含执行原语、provider 响应体或凭据。
- 不变量 §22（W3，@mos/contracts）：副作用型意图进入 executing/succeeded 前必须绑定**已批准**预览
  （preview_ref + preview_hash 且 approval_state=approved）——守卫 assertDistributionPreviewApproval
  在 approved→executing 边（domain）与每条落盘记录（application persist）双重调用，
  未绑定已批准预览的 executing/succeeded 记录不可能经任何写路径落盘（fail-closed）。
- 本包不 import 任何其他 @mos/* 包（@mos/integrations、@mos/content-artifacts、@mos/rights-policy
  均不出现）；connection_id / capability_instance_id / artifact_ref 全部是不透明引用，
  其存在性与权利/质量门禁的解析归各 authority + 组合根。

## Public entrypoints

- `@mos/distribution` → `src/index.ts`
- `@mos/distribution/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 store 方法）

## 状态机（contract/intent.ts + domain/intent-transitions.ts，纯函数、零 I/O、零 Date/random）

合法边（其余一律 IntentTransitionError，具名 current/target；unknown 无出边）：

```
intent → previewed（要求 preview_ref + preview_hash 已绑定；bindPreview 是正道，
                    直接转移未绑预览 → PreviewRequiredError）
previewed → pending_approval
pending_approval → approved | rejected（该转移即审批决定，同步写 approval_state）
approved → executing（要求预览已绑定 + approval_state=approved：
                      PreviewRequiredError / ApprovalRequiredError 具名；
                      物化后 assertDistributionPreviewApproval 终守卫）
executing → succeeded | failed
succeeded / failed / rejected：终态，无出边（rejected 不可执行）
```

- 创建（intentFromInput）：恒为 `status=intent`、preview 未绑定、`approval_state=pending`
  （三种操作全部有副作用，绝不写 not_required —— 不变量 §4/§5 语义）、`execution_records=[]`；
  其余字段逐字保存（artifact_version / idempotency_key 未提供保持 null，绝不填充猜测）。
- bindPreview：只在 `status=intent` 时可绑定，绑定即推进 previewed；绑定后不可重绑
  （换预览 = 新建意图，绝不静默改写已绑定的预览引用）。
- recordExecution：只在 executing/succeeded/failed 追加（append-only，逐字、不去重）；
  其余状态（含 rejected 与未审批阶段）追加执行证据 → IntentTransitionError
  （没有已批准预览的"执行证据"不可能是真实执行）；空引用 → IntentValidationError。
- 直接 target=executing 而未走 bindPreview 的路径在状态机上不可达（intent→previewed 边强制预览绑定）。

## Store（application/intent-store.ts，tenant-scoped、文件后端、原子写）

- 单文件 JSON（mos-distribution-intents.json，W1 mission-store 同构）：原子写（同目录 tmp + rename）；
  文件缺失 → 空启动（durable = 跨进程重启可读）；结构与 schema 损坏 fail-closed
  （ContractValidationError）；读取容忍未知键（additive）。
- createIntent：输入 shape 失败 → IntentValidationError（ContractValidationError 的类型化投影）；
  输入 tenant 与调用方不一致 → assertTenantScope InvariantViolation；
  idempotency_key 提供时按 (tenant, key) 唯一 —— 重复（含同 id 重试）→ IdempotencyConflictError
  （具名既有意图 id，调用方凭冲突错误查找既有意图，绝不静默重复创建）；
  不同租户同 key 互不冲突；未提供 key（null）不参与唯一性。
- bindPreview / applyTransition / recordExecution：未命中 id → IntentNotFoundError；命中他租户记录
  → InvariantViolation（绝不当作"不存在"处理）；全部经 domain 状态机。
- getIntent：未命中 → null；他租户 → InvariantViolation。listIntentsByTenant 只返回调用方租户的记录。
- 落盘前统一守卫：每条记录过 distributionIntentSchema + assertDistributionPreviewApproval
  （不变量 §22 具名，defense in depth —— 即使未来新增写路径也拦得住）。

## Layers

- `contract/intent.ts`：输入/绑定 schema、操作/状态/审批词表与类型化错误。
- `domain/intent-transitions.ts`：纯状态机（创建/绑定/转移/证据追加；零 I/O、零 Date/random）。
- `application/*`：JSON 文件持久化与幂等/租户编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：状态机矩阵 / store / 幂等 / 租户隔离 / 损坏 fail-closed 经契约测试覆盖；
  与真实 provider connector（Integration adapters）的挂接与端到端发布旅程属组合根/后续阶段
  （deferred；无 mock-as-live 声明 —— 测试中的意图记录与 evidence 引用均为内存/文件夹具，
  不构成任何真实 provider 集成证据）。

## 模块登记草案（module_registration_draft_note，供 TL 裁决）

- module-registry-v3.0.yaml：mos-distribution stage week-3 → contract-tested
  （depends_on [mos-contracts]——代码级依赖只有 @mos/contracts）。
- architecture-policy-v3.0.yaml：mos-distribution gate（roots / publicEntrypoints / layers）
  由 TL 补写（roots 建议 packages/mos-distribution/src + vitest.config.ts；publicEntrypoints
  packages/mos-distribution/src/index.ts + src/contract.ts；layers contract/domain/application）。
- scripts/engineering-test-files.json：本包两个测试文件是否纳入 engineering 清单由 TL 决定。

## 已知限制（显式，绝不静默）

- 预览记录（ExternalActionPreview）本身不在本包解析：bindPreview 只收 preview_ref + preview_hash；
  预览与意图的 operation/connection/capability_instance/target 一致性校验、以及预览的审批事件来源
  （既有 ZCode 权限系统）属组合根接线（W1 缝）。
- approval_state 的 expired 词汇无转移路径（W3 工作包未要求审批过期语义）；已 approved 意图的
  审批过期撤回属后续 additive 工作。
- 幂等键唯一性只在单文件存储内保证；跨进程并发写同一存储文件不是本阶段目标
  （W1/W2 JSON store 同一限制，继承）。
- 权利/质量门禁（rights/quality，决策锁 #20）不在本包：artifact 的 rights cleared 状态
  由 @mos/rights-policy authority + 组合根在发布链路上校验，本包只记录意图与审批。
