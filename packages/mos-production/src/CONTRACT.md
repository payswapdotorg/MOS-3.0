# mos-production CONTRACT

## Authority

- production（module-registry-v3.0.yaml）：Transform 定义、生产图（ProductionGraph）与
  持久生产业务状态（ProductionJob）的唯一 authority。
- 决策锁 #5（No parallel workflow engine）——**无第二执行器边界（显式）**：
  - ProductionGraph 是“生产程序描述”，编译到既有 ZCode Dynamic Workflow / AgentRuntime；
    MOS 只保存图记录并校验结构/引用，**不是执行器**；
  - ProductionJob 只是**持久业务状态**：本包**没有任何方法启动/运行/执行任何东西**
    （createJob 只建 pending 记录；applyTransition 只记录状态演化）；
  - `zcode_execution_ref` 是**组合根供给的不透明外部引用**（指向 ZCode 侧执行），
    由 `linked` 事件写入；`linked→executing` 只能经**外部观测事件**（`executing`，
    无 MOS 侧数据）记录；每次转移计算后无条件调用共享守卫 `assertJobNeverExecutes`
    （invariants §19）。
- 决策锁 #9：engine 节点只持不透明 ref；解析经注入的 `EngineLookup` 端口
  （组合根接到 @mos/engines 的注册表存储）——本包**不 import @mos/engines**；
  校验成功的图另经 `assertGraphEngineRefsOpaque`（invariants §20）最终守卫。
- 跨模块记录访问（graphs for jobs、transforms/engines for validation）**只经结构化
  lookup 端口**：`TransformLookup` / `EngineLookup` / `GraphLookup`；代码级依赖只有
  @mos/contracts + zod + node 内建（module.ts requires 只有 mos-contracts）。

## Public entrypoints

- `@mos/production` → `src/index.ts`
- `@mos/production/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 store 方法）

## Transform（contract/transform.ts + application/transform-registry.ts）

- `TransformDefinitionInput`（name、description nullable、parameters_schema、
  required_capability_id nullable、side_effect、risk_level、status）：id/tenant 由
  `TransformRegistry.register(tenantId, transformId, input)` 方法参数提供；
  逐字 intake（缺失可空字段 = null，绝不猜测）。
- register 是 upsert by id：输入先过 `transformDefinitionInputSchema`（失败 →
  类型化 `TransformValidationError`）；内容未变 → 幂等直返；内容变化 → `version+1`
  （created_at 保留）+ `updated_at=时钟当前值`（注入 TimePort，缺省 SystemTimePort）。
- get/listByTenant：租户内过滤；get 未命中 → `TransformNotFoundError`；
  命中他租户记录 → `assertTenantScope` InvariantViolation。
- Transform 是“期望操作定义”，不是执行（执行归 ZCode）；required_capability_id 是
  不透明能力引用（本包不校验能力存在性——端口对账归组合根，见「已知限制」）。

## Graph validation（domain/graph-validation.ts，纯函数）

`validateGraph({ graph, transformLookup, engineLookup })` → `{ valid, errors }`，
全部错误**具名收集**（错误串携带节点 id / 引用 id），绝不静默丢弃：

1. 节点 id 唯一（`duplicate node id: <id>`）；
2. 边引用的节点 id 存在（`edge <from> -> <to> references unknown node: <endpoint>`）；
3. 无环 DAG（`cycle detected: a -> b -> a`，含自环）；
4. 无孤儿节点（`orphan node: <id>`——单节点图除外：单节点即整图，允许无边）；
5. transform 节点 ref 经 `transformLookup(tenantId, transformId)` 解析且 status=active
   （null ref / 未解析 / draft|retired|unknown → 具名错误，如
   `unresolved transform ref: <ref> (node <id>)`、`transform not active: <ref> status=<status> (node <id>)`）；
6. engine 节点 ref 经 `engineLookup(tenantId, engineId)` 解析且 status 非 deprecated/unknown
   （`unresolved engine ref: <ref> (node <id>)`、`engine not usable: <ref> status=<status> (node <id>)`）。

额外 fail-closed 加严（超出 W3-B 清单，显式声明）：空节点集不是合法生产程序
（`graph has no nodes: ...`）。错误顺序确定：结构错误（重复 id → 边引用 → 环 → 孤儿）
→ 引用错误（transform → engine）。

## GraphStore（application/graph-store.ts，tenant-scoped、文件后端、原子写）

- 注入目录下单文件 `mos-production-graphs.json`；原子写（同目录 tmp + rename）；
  文件缺失 → 空启动；JSON/结构/schema 损坏 fail-closed（`ContractValidationError`）。
- `saveDraft(tenantId, graphId, input)`（upsert by id，恒为 draft）：内容变化 →
  `version+1` + 校验状态显式重置（status=draft、validated_at=null、
  validation_errors=[]）——改动后的图必须重新过 validate 门禁；内容未变 → 幂等直返。
- `validate(tenantId, graphId, { transformLookup, engineLookup })`（fail-closed 门禁）：
  - 成功：status=validated、validated_at=注入时钟当前值、validation_errors=[]，
    `assertGraphEngineRefsOpaque` 最终守卫后落盘（校验是当前版本的标注，不 bump version）；
  - 失败：先把具名错误落盘（原 draft 保持 draft；原 validated → invalidated、
    validated_at=null——**有错误的图绝不保持 validated**），再抛
    `GraphValidationError`（`validationErrors` 与落盘错误同源同名）——
    记录与异常双通道，绝不静默。
- 跨租户：saveDraft 遇他租户同 id 记录、get/validate 命中他租户记录 →
  `assertTenantScope` InvariantViolation；get/validate 未命中 → `GraphNotFoundError`。

## JobStore（application/job-store.ts，tenant-scoped、文件后端、原子写）

- 注入目录下单文件 `mos-production-jobs.json`；原子写；文件缺失 → 空启动；
  损坏 fail-closed。`graphLookup` 端口必选注入（job 创建的图门禁）。
- `createJob(tenantId, jobId, { graph_id, graph_version })`：
  - 图必须存在（端口未命中 → `GraphNotFoundError`；坏端口返回他租户图 →
    `assertTenantScope` InvariantViolation）；
  - 图必须 status=validated 且 graph_version 等于图当前版本（违反 →
    `JobCreationBlockedError`，reason 具名）；
  - job id 已存在（任何租户）→ `JobCreationBlockedError`（durable 状态记录不可覆盖）；
  - 创建恒为 status=pending、zcode_execution_ref=null。
- `applyTransition(tenantId, jobId, event)`（唯一状态演化写路径）：
  事件先过 `productionJobEventSchema`（失败 → `JobEventValidationError`），
  再走 domain 转移表（见下），最终守卫 `assertJobNeverExecutes`（决策锁 #5）。
- 跨租户：createJob 遇他租户同 id 记录、get/applyTransition 命中他租户记录 →
  InvariantViolation；get/applyTransition 未命中 → `JobNotFoundError`。

## Job transitions（domain/job-transitions.ts，纯函数）

- 事件词表（`productionJobEventSchema` 判别联合）：
  - `linked`（必须携带 `zcode_execution_ref` + `started_at`——组合根供给的外部引用）；
  - `executing`（**纯外部观测事件**，无 MOS 侧数据——决策锁 #5）；
  - `succeeded`（必须携带 `completed_at`）；
  - `failed`（必须携带 `failure` 说明）；
  - `cancelled`。
- 合法转移表：`pending→linked`、`linked→executing`（仅外部观测）、
  `executing→succeeded|failed`、`pending|linked→cancelled`；其余一律
  `JobTransitionError`（携带当前状态与事件名）。事件数据缺失（如 linked 无外部引用）
  同样 `JobTransitionError` 具名拒绝。
- `applyJobEvent(job, event, now)`：计算下一状态 → 事件数据逐字并入记录 →
  `productionJobSchema` 物化 → `assertJobNeverExecutes` 最终守卫（越过 linked 的
  记录必须持有外部执行引用）。
- **已知契约张力（显式上报 TL，本包未静默择一）**：共享守卫
  `assertJobNeverExecutes` 把 `cancelled` 视为“越过 linked”——从 `pending` 直接取消的
  记录（无外部执行引用）会被该守卫拒绝（InvariantViolation）。本包按 W3-B 工作包保持
  `pending→cancelled` 在转移表上合法；该路径在记录层被共享守卫 fail-closed 拦截并有
  契约测试钉死现状。属 spec（转移表）与 code（共享守卫）冲突，需 TL 裁决：
  或守卫排除 cancelled，或转移表删除 pending→cancelled。

## Layers

- `contract.ts` / `contract/{transform,graph,job}.ts`：输入/事件 schema、端口形状与类型化错误。
- `domain/{graph-validation,job-transitions}.ts`：纯函数（零 I/O、零 Date/random）。
- `application/*`：JSON 文件持久化与端口编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：注册/图校验/门禁/job 转移/store 行为经契约测试覆盖（端口全部使用
  内存 fake；无真实 provider 执行、无 mock-as-live 声明）。与组合根（ZCode workflow
  编译、执行观测回路）的挂接属后续阶段（deferred）。

## 已知限制（显式，绝不静默）

- **无执行路径**（决策锁 #5）：本包不编译图到 ZCode workflow、不观测执行、不写
  `executing` 之后的任何外部事实——执行观测回路归组合根（deferred）。
- `output_artifact_refs` 恒为 []：artifact 关联归 mos-content-artifacts authority（W3-A），
  写入口属后续 additive 阶段（deferred）。
- mission_id 是可空不透明引用：图存储不校验其存在性（工作包端口集仅含
  transformLookup/engineLookup/graphLookup，见 module.ts）。
- Transform 的 required_capability_id 不校验能力存在性（能力 authority 归
  @mos/capabilities + 组合根；本包不导入它）。
- 上述 pending→cancelled 与共享守卫 §19 的张力需 TL 裁决（见 Job transitions）。
