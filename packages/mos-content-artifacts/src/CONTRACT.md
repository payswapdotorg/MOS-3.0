# mos-content-artifacts CONTRACT

## Authority

- content-artifacts（module-registry-v3.0.yaml）：内容资产（Artifact）不可变版本、
  provenance 与 artifact lineage 的唯一 authority（"Content assets, immutable versions,
  provenance and artifact lineage"）。
- 不变量 §7（core-contracts-v3.0.yaml）："Artifact versions and their parent lineage are
  immutable"——本包在写边界以 `assertArtifactLineageImmutability`（@mos/contracts）+
  领域严格化规则（domain/artifact-lineage.ts）双重强制。
- 永不保存内容字节：`content_ref` 只是不透明引用字符串（输入 schema 复用
  `opaqueRef`——疑似内联令牌值 fail-closed）；MOS 不持有内容载荷。
- 不拥有任何 Zcode 权威；不存任何密钥/凭据；registry 中 depends_on 的
  mos-identity-bridge 经组合根结构性满足（tenant 上下文由调用方注入）。

## Public entrypoints

- `@mos/content-artifacts` → `src/index.ts`
- `@mos/content-artifacts/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 store 方法）

## 版本链与血缘规则（domain/artifact-lineage.ts，纯函数、零 I/O、零 Date/random）

- `nextVersion(artifact)`：唯一可创建的下一版本号 = `artifact.version + 1`——
  版本号永不来自调用方输入，由版本链推导（store 据此构造版本 N）。
- `lineageAppend(previous, next)`（写边界校验，违规抛 `ArtifactVersionConflictError`）：
  - `previous === null`（首版本）：`next.version` 必须为 1 且 `parent_artifact_refs`
    必须为空（首版本没有可引用的父系血缘）；
  - `previous !== null`（后续版本）：
    1. `next.id` 必须等于 `previous.id`——版本 N 只能从同一 artifact id 的
       父版本 N-1 创建；
    2. `next.version` 必须等于 `previous.version + 1`——版本跳级（v1→v3）与
       回退/重复一律拒绝（比不变量 §7 的"必须递增"更严格的领域规则）；
    3. `next.parent_artifact_refs` 必须逐字等于 `previous.parent_artifact_refs`
       （"parent refs must equal previous lineage"）——已发布版本的父系血缘不可
       修改，血缘改写尝试 = 版本冲突；
    4. 最终守卫 `assertArtifactLineageImmutability(previous, next)`（不变量 §7）。
- 血缘语义：`parent_artifact_refs` 是 artifact 的派生血缘（指向父 artifact 版本的
  不透明引用），跨版本逐字携带；本包写边界（首版本必须为空 + 后续逐字携带）产出的
  记录血缘恒为空——带非空血缘的派生 artifact 写入 deferred（组合根/后续周扩展点），
  读取面（artifactRecordSchema + listChildren）已按共享 schema 支持非空血缘记录。
- quality_status / rights_status 经不可变版本链演化：每个新版本携带新状态，
  已发布版本永不改写（无原地状态迁移 API）。

## Intake 规则（contract/artifact.ts）

- `ArtifactVersionInput` 不含 version / created_at：版本号由版本链推导，
  created_at 由注入 deps 提供；provenance 必填且至少一条（每条 `source` 非空 +
  `observed_at` RFC3339 UTC——不变量 §6 同源纪律）；其余字段逐字 intake
  （缺失绝不猜测，数组逐字复制）。
- 输入 schema 失败 → 类型化 `ArtifactValidationError`（ContractValidationError 投影）。
- 持久记录 schema（artifactRecordSchema）：共享 artifactSchema 的无默认值投影
  （文件格式全显式，缺键即校验失败——读边界绝不静默补全；W2 nodeOfferRecordSchema
  同模式），并收紧 provenance 非空与引用非空字符串（本存储是唯一写 authority，
  其文件即写边界产出物）。

## Store（application/artifact-store.ts，tenant-scoped、文件后端、原子写）

- 单文件 JSON（`mos-artifacts.json`，W1/W2 store 同构）：原子写（同目录 tmp + rename）；
  文件缺失 → 空启动（durable = 跨进程重启可读）；JSON/结构/记录损坏 fail-closed
  抛 ContractValidationError。
- `registerFirstVersion(tenantId, input, deps)`：恒为 version 1、输入血缘必须为空；
  artifact 已存在（同 id，任何租户）→ `ArtifactVersionConflictError`。
- `registerNextVersion(tenantId, input, deps)`：恒为 `previous.version + 1`
  （跳级在写边界结构上不可表达）；输入血缘必须逐字等于上一版本血缘
  （血缘改写 → `ArtifactVersionConflictError`）；artifact 不存在 →
  `ArtifactNotFoundError`；artifact 属他租户 → InvariantViolation（绝不静默接链）。
- `getVersion(tenantId, artifactId, version)`：不存在 → `ArtifactNotFoundError`；
  命中他租户记录 → `assertTenantScope` InvariantViolation（绝不当作"不存在"处理）。
- `latestVersion(tenantId, artifactId)`：该租户内最高版本；无任何版本 →
  `ArtifactNotFoundError`；记录全部属他租户 → InvariantViolation。
- `listByTenant(tenantId)` / `listChildren(tenantId, parentRef)`：只返回调用方租户的
  记录；listChildren 按不透明引用精确匹配（绝不解析引用结构）。
- tenant 边界：artifact id 在存储内全局唯一——跨租户同 id 写入（registerFirst /
  registerNext）显式拒绝（InvariantViolation），与 W2 get-by-id 语义一致；
  列表操作天然租户过滤。

## Layers

- `contract.ts` / `contract/artifact.ts`：类型、词表、schema 与类型化错误。
- `domain/artifact-lineage.ts`：纯函数（零 I/O、零 Date/random）。
- `application/artifact-store.ts`（+ `support.ts`）：文件持久化与版本注册编排
  （node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：版本链/血缘/tenant 隔离/持久化经契约测试覆盖；与组合根
  （transform/production 输出 artifact 的写入路径）的挂接属后续阶段（deferred）。

## 已知限制（显式，绝不静默）

- 带非空 parent_artifact_refs 的派生 artifact 写入路径 deferred：写边界产出的血缘
  恒为空；读取面已支持非空血缘（组合根写入的记录经 artifactRecordSchema 读取）。
- transform_id 恒为 null：ArtifactVersionInput 不含 transform_id（W3-A 工作包字段清单），
  transform 关联（transform 输出 artifact）归 W3-B/组合根接线。
- 不校验 parent_artifact_refs 引用目标的存在性（无跨模块 lookup 端口；引用解析归组合根）。
- 领域事件发射 deferred（与 W2 各包一致；durable 记录即 authority）。
