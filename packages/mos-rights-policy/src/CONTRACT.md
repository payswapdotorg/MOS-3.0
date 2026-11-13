# mos-rights-policy CONTRACT

## Authority

- rights-policy（module-registry-v3.0.yaml）：权利、同意、源许可、平台政策与评审决定的
  唯一 authority（"Rights, consent, source licensing, platform policy and review decisions"）。
- 不变量 §18（core-contracts-v3.0.yaml）："A rights gate never guesses: an artifact is
  cleared for use only with a granted, unexpired rights decision covering it; missing,
  pending, expired and restricted all deny (fail-closed)"——共享守卫
  `assertRightsClearedForUse`（@mos/contracts）是语义基准；本包的
  `evaluateRightsGate` 是其判定对象化镜像（不抛错、返回 verdict），并双向锚定一致性。
- review_decision 追加式（append-only）：已存在记录（同 id）的 decision 不可改——
  改变决定必须追加一条新 id 的新记录（写边界强制）。
- registry 中 depends_on 的 mos-content-artifacts / mos-identity-bridge 经组合根结构性满足：
  `subject_artifact_ref` 只是不透明引用字符串，本包不导入 @mos/content-artifacts
  （引用存在性解析归组合根，artifactLookup 接线属后续阶段）。

## Public entrypoints

- `@mos/rights-policy` → `src/index.ts`
- `@mos/rights-policy/contract` → `src/contract.ts`（类型窄口 + 错误再导出 + deps/端口形状）

## 权利门禁（domain/rights-gate.ts，纯函数、零 I/O、零 Date/random）

- `evaluateRightsGate({ artifactRef, records, now })` → `{ cleared, reason }`：
  - 覆盖判定与 `assertRightsClearedForUse` 同源：`subject_artifact_ref` 精确匹配
    artifactRef 或 null 通配；kind 为 `unknown` 的记录不覆盖任何 artifact；
  - cleared 仅当存在覆盖记录且 decision=granted + decided_at 非空 + 未过期
    （expires_at 为 null 或严格大于 now）；
  - 拒绝原因具名且确定（优先级 denied > pending > expired > 残余）：
    | reason | 触发条件 |
    | --- | --- |
    | no_covering_record | 无覆盖记录（缺记录 = 拒绝） |
    | explicit_denial | 覆盖记录中存在 denied 决定 |
    | decision_pending | 无有效 granted 且存在 pending 决定 |
    | expired | 无有效 granted/pending 且存在过期（存储 decision=expired，或 granted 但 expires_at <= now） |
    | no_valid_decision | 残余不可分类（decision=unknown，或 granted 但 decided_at 为空）——永不猜测 |
  - 过期边界（与 assert 的 `record.expires_at > now` 严格一致）：`expires_at === now`
    即已过期——只有严格大于 now 才有效（== 不通过，绝不放行）；
  - 一致性锚定：每个判定都与 `assertRightsClearedForUse` 复核（cleared ⇔ 守卫不抛错），
    任何方向不一致 → InvariantViolation（本门禁绝不允许越过共享契约）。
- 输入永不被变异；tenant 范围由调用方（service/store）预先过滤。

## Intake 规则（contract/rights.ts）

- `RightsRecordInput`：kind 限可写词表（source_license / consent / platform_policy /
  review_decision——`unknown` 是读取侧未分类词，不可写入）；decision 用共享
  rightsDecisionSchema 词表（gate 对任何值 fail-closed 处理）；decided_at 允许为
  null（pending 决定不猜时间）；constraints / evidence_refs 逐字保存。
- id / created_at / updated_at 由注入 deps 提供（upsert 时 created_at 保持首写值、
  updated_at 以注入 now 推进）。
- 持久记录 schema（rightsRecordRecordSchema）：共享 rightsRecordSchema 的无默认值投影
  （文件格式全显式，缺键即校验失败——读边界绝不静默补全；W2 同模式）。

## Store（application/rights-store.ts，tenant-scoped、文件后端、原子写）

- 单文件 JSON（`mos-rights-records.json`，W1/W2 store 同构）：原子写（同目录 tmp + rename）；
  文件缺失 → 空启动；JSON/结构/记录损坏 fail-closed 抛 ContractValidationError。
- `saveRecord(tenantId, input, deps)`（upsert by id）：
  - review_decision 追加式：已存在记录（同 id）为 review_decision 时 decision 不可改、
    kind 不可改（防洗牌绕过）→ RightsValidationError；同 decision 的原样重存允许
    （如推进 expires_at）；非 review_decision 记录自由 upsert；
  - 跨租户同 id 写入 → assertTenantScope InvariantViolation。
- `getRecord(tenantId, recordId)`：不存在 → RightsRecordNotFoundError；他租户 →
  InvariantViolation（绝不当作"不存在"处理）。
- `listByTenant(tenantId)` / `listForArtifact(tenantId, artifactRef)`：租户内过滤；
  listForArtifact 返回精确覆盖（subject_artifact_ref === artifactRef）+ 通配覆盖
  （subject_artifact_ref === null）记录。

## Gate service（application/rights-gate-service.ts）

- `evaluateForArtifact(tenantId, artifactRef)`：store.listForArtifact 拉取记录 →
  注入 TimePort 的 now → 纯门禁评估 → 返回 verdict。
- fail-closed：未知 artifact（无覆盖记录）→ denied（no_covering_record）；
  now 一律经注入 TimePort（评估可复现）；服务只读，不写任何权利记录。

## Layers

- `contract.ts` / `contract/rights.ts`：类型、可写词表、schema、TimePort 与类型化错误。
- `domain/rights-gate.ts`：纯门禁评估（零 I/O、零 Date/random）+ 共享守卫锚定。
- `application/*`：文件持久化 + 门禁服务编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：门禁矩阵（含与 assertRightsClearedForUse 的一致性 oracle）、
  追加式守卫、tenant 隔离与持久化经契约测试覆盖；与组合根（artifact 引用解析、
  New Task 流程挂接）的接线属后续阶段（deferred）。

## 已知限制（显式，绝不静默）

- subject_artifact_ref 的引用目标存在性不校验（无 artifactLookup 端口；
  引用解析归组合根，与 mos-content-artifacts 的接线属后续阶段）。
- constraints 词表语义（字符串清单）不做机器可判定解释：门禁只依据
  decision/decided_at/expires_at 与覆盖关系判定；constraints 的下游解释
  （如渠道限制）归使用方（distribution/production）。
- 非 review_decision 记录的 upsert 允许演化（constraints / expires_at 可更新）；
  这是与 review_decision 追加式相对的自由面（契约如此规定，已在测试中固化）。
- 领域事件发射 deferred（与 W2 各包一致；durable 记录即 authority）。
