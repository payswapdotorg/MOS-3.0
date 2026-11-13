# mos-experiments CONTRACT

## Authority

- experiments（module-registry-v3.0.yaml）：实际世界实验的设计、指派、测量证据引用与**结果**
  （outcome）的唯一 authority —— **决策锁 #18**："Lab simulation is not an experiment; Experiment
  authority owns actual experiment definition, evidence and outcomes."
- outcome 只在本包可写，且只有一条写入路径：`concludeExperiment`（analyzed→concluded，
  必须携带非空 measurement_evidence_refs + concluded_at；`assertExperimentOutcomeEvidence`
  终守卫 + 每条落盘记录再跑一次——不变量 §21 具名，defense in depth）。
  创建/转移输入的形状上**不可表达**结果语义（experimentInputSchema / experimentTransitionSchema
  均无 outcome 字段；transition union 无 concluded 变体）。
- 决策锁 #8：本包零 provider I/O —— measurement_evidence_refs 只是不透明证据引用；
  测量/观测由组合根（Integration adapters 之外的真实世界观测）回填。无密钥、无凭据、
  无 mock-as-live 声明。
- 假设采纳缝（W2→W3）：@mos/lab 的 saveHypothesis 把 `adopted_by_experiment + experiment_ref`
  组合的写入权保留给 W3（见其 CONTRACT.md）；本包经**结构化端口** HypothesisUpdatePort 行使
  该写入权——端口形状 = `(tenantId, Hypothesis & {status:"adopted_by_experiment",
  experiment_ref:string})`，与 lab 的 saveHypothesis 输入结构一致；**本包绝不 import @mos/lab**
  （组合根接线；与 mos-lab 消费 mission/route/offer 的 lookup 端口 seam 同模式）。

## Public entrypoints

- `@mos/experiments` → `src/index.ts`
- `@mos/experiments/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 store/service 方法）

## 生命周期（contract/experiment.ts + domain/experiment-lifecycle.ts，纯函数、零 I/O、零 Date/random）

```
defined → assigned（必须携带 assignment record）
assigned → measuring（记录 started_at，只补不覆盖）
measuring → analyzed
analyzed → concluded（只能经 concludeExperiment：outcome + 非空 evidence refs + concluded_at）
defined/assigned/measuring/analyzed → cancelled（any→cancelled）
concluded / cancelled：终态；unknown：无出边（fail-closed）
```

- 非法边（跳态/回退/终态转出/unknown）→ `ExperimentTransitionError`（具名 current/target）。
- 直接 `target=concluded` → `ExperimentTransitionError`（outcome 只能经 concludeExperiment）。
- concludeExperiment：状态非 analyzed → `ExperimentTransitionError`（**outcome before concluded
  一律拒绝**）；evidence_refs 为空 → `OutcomeEvidenceRequiredError`（具名缺失项）；
  产物 status=concluded + outcome + outcome_note（逐字）+ measurement_evidence_refs（逐字复制）
  + concluded_at，`assertExperimentOutcomeEvidence`（不变量 §21）终守卫。
- "any→cancelled" 的边界：concluded 是有证据支撑的历史结论，取消已收尾的实验必然造出
  "outcome 非 null 而 status 非 concluded" 的违约记录（与不变量 §21 冲突）——因此
  concluded/cancelled 视为不可再转的终态；unknown 记录同样无出边（绝不猜测）。

## 假设采纳（contract/adoption.ts + domain/adoption.ts + application/adoption-service.ts）

- buildAdoption（纯函数）判定矩阵（全部 fail-closed 具名）：
  1. 假设与实验同租户（不一致 → InvariantViolation，与 lab 输入一致性守卫同模式）；
  2. 实验状态 ∈ {assigned, measuring, analyzed, concluded}（defined = 实验未开始 →
     `HypothesisAdoptionError(experiment_status_invalid)`）；
  3. `hypothesis.mission_id === experiment.mission_id`（实验无 mission 或指向不同 mission →
     `mission_mismatch`）；
  4. 假设状态 ∈ {proposed, superseded}（已采纳/withdrawn/unknown → `hypothesis_status_invalid`）。
- 产物：`status="adopted_by_experiment"`、`experiment_ref=experiment.id`、`updated_at=注入时间`，
  其余字段逐字保留；经 hypothesisSchema + `assertHypothesisCarriesNoOutcome`（不变量 §15）守卫。
- AdoptionService.adoptHypothesis(tenantId, {experimentId, hypothesis}, deps)：校验先于副作用——
  读取实验（未命中 → ExperimentNotFoundError；他租户 → InvariantViolation）、校验调用方提供的
  当前假设记录（hypothesisSchema + assertTenantScope；实验已链接其他假设 →
  `experiment_hypothesis_conflict`）、buildAdoption 判定、调用注入端口（**端口抛错原样上抛，
  采纳不继续**）、端口成功后仅把 hypothesis.id 落到实验的 hypothesis_id 字段
  （**除此之外不记录任何假设数据**）。

## Store（application/experiment-store.ts，tenant-scoped、文件后端、原子写）

- 单文件 JSON（mos-experiments.json，W1 mission-store 同构）：原子写（同目录 tmp + rename）；
  文件缺失 → 空启动（durable = 跨进程重启可读）；结构与 schema 损坏 fail-closed
  （ContractValidationError）；读取容忍未知键（additive）。
- define：输入 shape 失败 → ExperimentValidationError（类型化投影）；tenant 不一致 →
  InvariantViolation；创建恒为 status=defined。
- applyTransition / conclude / linkHypothesis：未命中 → ExperimentNotFoundError；他租户 →
  InvariantViolation；全部经 domain；每条落盘记录过 experimentSchema +
  assertExperimentOutcomeEvidence。
- getExperiment 未命中 → null；listExperimentsByTenant / listExperimentsByMission 只返回调用方
  租户的记录（mission_id 为 null 的实验永不匹配 mission 过滤）。

## Layers

- `contract/experiment.ts`：输入/转移/收尾 schema、状态词表与类型化错误（含 HypothesisAdoptionError）。
- `contract/adoption.ts`：HypothesisUpdatePort、AdoptedHypothesis、采纳输入/依赖形状。
- `domain/experiment-lifecycle.ts` / `domain/adoption.ts`：纯状态机与纯采纳构造（零 I/O、零 Date/random）。
- `application/*`：JSON 文件持久化、端口编排与采纳服务（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：生命周期矩阵 / store / 采纳缝（fake 端口证明成功与 fail-closed 拒绝）/
  租户隔离 / 损坏 fail-closed 经契约测试覆盖；与 @mos/lab saveHypothesis 的真实接线、
  与测量/观测源的组合根挂接属组合根阶段（deferred；测试中的端口是内存 fake，
  不构成任何真实 lab/provider 集成证据）。

## 模块登记草案（module_registration_draft_note，供 TL 裁决）

- module-registry-v3.0.yaml：mos-experiments stage week-3 → contract-tested
  （depends_on [mos-contracts, mos-lab]——代码级依赖只有 @mos/contracts，mos-lab 经
  HypothesisUpdatePort 结构性满足，写入权即决策锁 #18 的 W3 投影）。
- architecture-policy-v3.0.yaml：mos-experiments gate（roots / publicEntrypoints / layers）
  由 TL 补写（roots 建议 packages/mos-experiments/src + vitest.config.ts；publicEntrypoints
  packages/mos-experiments/src/index.ts + src/contract.ts；layers contract/domain/application）。
- scripts/engineering-test-files.json：本包三个测试文件是否纳入 engineering 清单由 TL 决定。

## 已知限制（显式，绝不静默）

- 端口与实验存储之间无跨存储事务：端口成功而 linkHypothesis 失败时假设已采纳但实验未记录
  链接（错误具名上抛，对账归组合根；单进程顺序调用下该路径不可达——service 在调用端口前
  已做同样的冲突判定）。
- measurement_evidence_refs 只在 conclude 时一次性写入（W3 工作包未要求逐条追加 API）；
  中间阶段的测量记录追加属后续 additive 工作。
- mission_id / hypothesis_id 是可空引用：define 不校验其存在性（工作包端口集为空——
  采纳路径经调用方提供记录 + buildAdoption 判定，不注入 lab/mission lookup 端口）。
- design / assignment 记录的内部形状不在此层语义化（自由形状 record，契约如此）。
- 跨进程并发写同一存储文件不是本阶段目标（W1/W2 JSON store 同一限制，继承）。
