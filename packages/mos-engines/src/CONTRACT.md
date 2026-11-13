# mos-engines CONTRACT

## Authority

- engines（module-registry-v3.0.yaml）：Engine 注册表记录（display name、technical capability ids、
  provider id nullable、sandbox policy 描述符、benchmark refs、license、cost model、status）与
  capability → engine 匹配的唯一 authority。
- 决策锁 #9（No engine imports from Lab/Studio/domain）：本包**只有注册表 + 描述符**——
  **没有 engine 导入，没有任何调用/执行路径**（NO invocation path exists）。Engine 由 Engine
  Registry 选择，经组合根的沙箱适配器调用；实际的执行适配器是组合根的职责（deferred）。
- sandbox_policy 是 DESCRIPTOR ONLY（contract/sandbox-policy.ts）：描述“一次沙箱化调用被允许
  做什么”（network_egress / filesystem_scope / timeout_ms），不含任何执行代码，也不被本包执行。
- 不拥有任何 ZCode 权威；不存任何密钥/凭据（记录只含不透明引用与描述性字段）。

## Public entrypoints

- `@mos/engines` → `src/index.ts`
- `@mos/engines/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 registry 方法）

## Sandbox policy（contract/sandbox-policy.ts）

- `sandboxPolicySchema`：`network_egress: boolean`、`filesystem_scope: "workspace"|"none"|"unknown"`
  （封闭词表）、`timeout_ms: 正整数 | null`。全部字段显式必填——缺键即校验失败，绝不猜测默认。
- `validateSandboxPolicy(policy)`：fail-closed——未知 scope 值、缺失字段、非布尔 network_egress、
  非正整数 timeout_ms 一律拒绝（`SandboxPolicyValidationError`，携带具名 issues）；
  成功返回规范化描述符（未知键剥离）。

## Registration（contract/engine.ts + application/engine-registry.ts）

- `EngineRegistrationInput`（display_name、capability_ids、provider_id、sandbox_policy record、
  benchmark_refs、license_terms、cost_model、status）：id 与 tenant_id 由
  `EngineRegistry.register(tenantId, engineId, input)` 的方法参数提供。
- 写边界双重 fail-closed：先过 `engineRegistrationInputSchema`，再过 `validateSandboxPolicy`
  （两者的失败都投影为类型化 `EngineValidationError`，携带具名 issues）；sandbox_policy 以
  规范化描述符落库。
- register 是 upsert by id：同 (tenant, id) 内容未变 → 幂等直返（不写文件、不 bump 版本、
  不改时间戳）；内容变化 → `version+1`（created_at 保留）+ `updated_at=时钟当前值`（注入
  TimeSource，缺省 SystemTimeSource）。
- benchmark_refs / license_terms / cost_model 逐字保存（不透明引用与描述性值；本阶段不做
  benchmark/license 的真实性校验，见「已知限制」）。

## Capability matching（domain/matching.ts，纯函数）

- `matchEnginesForCapability({ engines, capabilityId })`：
  - `matched`：capability_ids 覆盖该能力且 status ∈ {registered, benchmarked}；
  - `excluded`：覆盖该能力但 status ∈ {deprecated, unknown} 的 engine 逐条携带
    `{ engine, reason: "deprecated" | "unknown_status" }`——**绝不静默隐藏，也绝不静默匹配**；
  - 未知能力不是错误：matched/excluded 均为空且 `noEngineRegistered=true`
    （调用方可显式区分“无 engine 注册该能力”与“有 engine 但全部被排除”）。
- 纯函数、零 I/O、零 Date/random；永不变异输入；matched/excluded 保持输入顺序。
- `EngineRegistry.listForCapability(tenantId, capabilityId)`：先按 tenant 过滤（跨租户记录
  不可见），再交领域匹配器。

## Registry stores（application/engine-registry.ts，tenant-scoped、文件后端、原子写）

- 注入目录下单文件 `mos-engines.json`；原子写（同目录 tmp + rename）；文件缺失 → 空启动
  （durable = 跨进程重启可读）；JSON/结构/schema 损坏 fail-closed（`ContractValidationError`）。
- 读边界：每条记录过 `engineSchema` + `validateSandboxPolicy`（沙箱策略是安全语义字段，
  描述符损坏的记录 fail-closed，绝不作为可用 engine 表面化）。
- tenant 边界：register 遇他租户同 id 记录、get 命中他租户记录 → `assertTenantScope`
  InvariantViolation；get 对不存在的 id → `EngineNotFoundError`；listByTenant 只返回
  调用方租户的记录。

## Layers

- `contract.ts` / `contract/{engine,sandbox-policy}.ts`：输入 schema、词表、描述符与类型化错误。
- `domain/matching.ts`：纯匹配器（零 I/O、零 Date/random）。
- `application/*`：JSON 文件持久化与注册编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：注册/匹配/沙箱策略校验/store 行为经契约测试覆盖（全部使用内存与临时目录；
  无真实 provider 执行、无 mock-as-live 声明）。执行适配器与组合根挂接属后续阶段（deferred）。

## 已知限制（显式，绝不静默）

- 沙箱策略只校验描述符形状，不执行/不强制执行（无 invocation 路径——决策锁 #9；
  执行时强制执行归组合根的沙箱适配器，deferred）。
- benchmark_refs / license_terms / cost_model 是不透明引用与描述性值，本包不校验 benchmark
  证据或 license 真实性（证据归属 evidence/实验 authority）。
- engine 与 capability 的关联只按 capability_ids 字符串精确匹配；capability 记录的存在性/
  可用性校验归 @mos/capabilities + 组合根（本包不导入它，端口对账归 TL）。
