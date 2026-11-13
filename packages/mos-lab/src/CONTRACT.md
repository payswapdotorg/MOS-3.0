# mos-lab CONTRACT

## Authority

- lab（module-registry-v3.0.yaml）：市场研究（ResearchNote）、假设（Hypothesis）与生产程序发现
  （program discovery）的 authority。
- 决策锁 #18：Lab 提出假设与路线；实验定义/证据/结果归 Experiment authority（W3）。
  本模块任何写路径都不得携带结果语义：假设创建恒为 `status="proposed"`、`experiment_ref=null`
  （`domain/hypothesis.ts` 的 `hypothesisFromProposal` 强制）；`experiment_ref` 任何非 null 值、
  `adopted_by_experiment` 状态在 lab 写边界一律 fail-closed（`assertLabHypothesisCarriesNoOutcome`）——
  即使契约不变量 §15 允许 (adopted_by_experiment + experiment_ref) 组合，其写入权也归 W3。
- 决策锁 #8/#9：领域/应用层零 provider I/O、零 engine 导入、零 LLM 调用。全部外部记录经
  结构化 lookup 端口注入：`evidenceLookup` / `missionLookup` / `hypothesisLookup` /
  `routeLookup` / `offerLookup`。组合根负责把端口接到 @mos/missions、@mos/routes、
  @mos/agent-organizations 与 evidence 存储——本包不 import 它们（`module.ts` requires 只有
  mos-contracts；registry 中 depends_on 的 mos-missions/mos-capabilities/mos-routes 经端口
  结构性满足，与 mos-routes 消费能力实例的 seam 方式一致，见其 CONTRACT.md「评估输入」）。

## Public entrypoints

- `@mos/lab` → `src/index.ts`
- `@mos/lab/contract` → `src/contract.ts`（类型窄口 + 错误再导出 + intake/proposal deps 形状）

## ResearchNote（contract/research.ts + domain/research-note.ts + application/research-note-store.ts）

- intake 逐字（verbatim topic/insight；零推断）：未提供字段保持 null/[]，绝不填充；
  findings 每条 = `{ evidence_ref, statement }`（复用 core-contracts researchFindingSchema）。
- 写边界门禁（不变量 §16）：`saveNote` 对每条 finding 调用 `assertResearchFindingEvidence`——
  `evidenceLookup(ref)` 返回 undefined（引用不存在的 evidence）或 `kind === "simulation"`
  （simulation 不得充当 provider 观测）都 fail-closed 抛 InvariantViolation，整条 note 不落盘。
  evidence 的 tenant 范围约束由注入方（组合根）承担。
- ResearchNoteStore：注入目录下单文件 `mos-research-notes.json`；原子写（同目录 tmp + rename）；
  文件缺失 → 空启动；读取容忍未知键（additive），JSON/结构损坏 fail-closed 抛 ContractValidationError。
- tenant 边界（按 W2-B 工作包约定，区别于 mos-missions 的不可见语义——跨租户访问显式拒绝）：
  `saveNote` 遇 tenant 不一致、`getNote` 命中他租户记录 → `assertTenantScope` InvariantViolation；
  未命中任何记录的 id → null；`listNotes` / `listNotesByMission` 只返回调用方租户的记录
  （`mission_id` 为 null 的笔记永不匹配 mission 过滤）。
- `mission_id` 是可空引用：note store 不校验其存在性（工作包端口集仅含 evidenceLookup，
  见「已知限制」）。

## Hypothesis（contract/hypothesis.ts + domain/hypothesis.ts + application/hypothesis-store.ts）

- `HypothesisProposal` 不含 status / experiment_ref 字段——结果语义在 intake 形状上即不可表达；
  `hypothesisFromProposal` 恒产 `status=proposed`、`experiment_ref=null`，产物经
  hypothesisSchema + `assertHypothesisCarriesNoOutcome` 双向守卫。
- HypothesisStore（missionLookup 端口注入）：
  - `proposeHypothesis`：`missionLookup(tenant, mission_id)` 返回 undefined →
    MissionNotFoundError（端口按 tenant 解析：他租户 mission 与不存在同义）；
    坏端口返回他租户 mission → `assertTenantScope` InvariantViolation。
  - `saveHypothesis`（全记录写路径，供 superseded/withdrawn 生命周期演化）：同样要求
    mission 存在；经 `assertLabHypothesisCarriesNoOutcome`——experiment_ref 非 null、
    adopted_by_experiment 一律 fail-closed（决策锁 #18）。
  - `getHypothesis`：未命中 → null；他租户记录 → InvariantViolation；
    `listHypotheses` / `listHypothesesByMission`：租户内过滤。
- 持久化与 mos-research-notes 同模式（`mos-hypotheses.json`，原子写，损坏 fail-closed）。
- `evidence_refs` / `proposed_route_ids` 逐字保存；假设 status 过滤（withdrawn/superseded
  是否参与下游推导）由调用方选择。

## Program discovery（contract/program-discovery.ts + domain/program-discovery.ts + application/program-discovery-service.ts）

- 输入（纯函数 `deriveProgramSuggestions`）：mission + hypotheses + routeCandidates +
  offersByCapability + now（TimePort 锚点）。
  `RouteCandidateFact = { route: 既有 Route 记录, capability_ids }`——capability_ids 由组合根从
  路由 steps 的 capability_instance_id 解析配对带来，lab 绝不从 instance id 猜 capability id。
- 规则（零 fabrication，全部判据来自输入记录；只引用、绝不复制/发明 route 或 offer）：
  1. 每条假设产出一个 suggestion：`id = lab-program:<mission_id>:<hypothesis_id>`
     （确定性，重推导可对账），`created_at = now`。
  2. 假设 proposed_route_ids 中类别 existing/conditional 的路由 → route_refs。
  3. 可建议路由引用的每个 capability：只有 `status=published` 的 offer 被引用
     （draft/withdrawn/expired/unknown 一律不引用）；无 published offer →
     missing_preconditions 显式标记 `no published offer for capability <id>`；
     路由未引用任何 capability（含 no-op/复用路由，决策锁 #17）→ 无 offer 匹配、无缺口标记。
  4. blocked / unknown / opportunity_constrained 路由 → 绝不进 route_refs，
     missing_preconditions 显式标记 `route <id> not actionable: route_class:<class>`
     （绝不静默丢弃）。
  5. 假设未引用任何路由 → `no_proposed_routes` 显式标记。
  6. 假设引用未传入的路由 id → RouteNotFoundError（fail-closed，绝不猜测类别）。
  7. 输入一致性 → InvariantViolation：假设/路由/offer 的 tenant 或 mission 绑定与 mission
     不一致；重复的假设/路由候选/offer id（去重是调用方职责，绝不静默合并）。
  8. 产物逐条经 labProgramSuggestionSchema parseOrFail。
- `ProgramDiscoveryService`（端口编排，fail-closed）：missionLookup/hypothesisLookup/
  routeLookup/offerLookup 逐个解析——undefined → MissionNotFoundError /
  HypothesisNotFoundError / RouteNotFoundError（绝不猜测）；offerLookup 只为可建议路由
  引用的 capability 调用；端口返回的假设不属于 (tenant, mission) → InvariantViolation
  （领域推导器对全部记录复检一次）。

## Layers

- `contract/lab-vocabulary.ts`：状态/类别词表、显式缺口标记、TimePort（结构化注入）。
- `contract/research.ts` / `contract/hypothesis.ts` / `contract/program-discovery.ts`：
  intake/proposal/suggestion 契约 schema、lookup 端口形状与类型化错误。
- `domain/research-note.ts` / `domain/hypothesis.ts`：纯 intake/proposal 构造 + lab 写边界守卫
  （零 I/O、零 Date/random）。
- `domain/program-discovery.ts`：纯推导器 + 输入一致性守卫（零 I/O、零 Date/random）。
- `application/*`：JSON 文件持久化（原子写）+ 端口编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：intake/proposal/store/推导矩阵经契约测试覆盖（端口全部使用内存 fake；
  无真实 provider 执行、无 mock-as-live 声明）。与真实 mission/route/offer 存储和
  New Task UI 的挂接属组合根阶段（deferred）。

## 模块登记草案（module_registration_draft_note，供 TL 裁决）

- module-registry-v3.0.yaml：mos-lab stage week-2 status planned → contract-tested
  （depends_on [mos-contracts, mos-missions, mos-capabilities, mos-routes] 不变——
  代码级依赖只有 @mos/contracts，其余经结构化端口满足）。
- architecture-policy-v3.0.yaml：mos-lab gate（roots / publicEntrypoints / layers）由 TL 补写
  （roots 建议 packages/mos-lab/src + vitest.config.ts；publicEntrypoints
  packages/mos-lab/src/index.ts + src/contract.ts；layers contract/domain/application）。
- scripts/engineering-test-files.json：本包三个测试文件是否纳入 engineering 清单由 TL 决定。

## 已知限制（显式，绝不静默）

- 领域事件发射（对应 mission.created 的 note/hypothesis 事件）deferred：W2-B 工作包未要求
  事件边界，组合根需要时 additive 补充。
- research note 的 mission_id 与 hypothesis 的 evidence_refs 不做存在性校验（工作包端口集仅含
  evidenceLookup[研究发现证据] 与 missionLookup[假设写边界]）。
- offer/路由记录的时效性（如 expired 判定）不在此层：只按 status 词汇引用 published。
