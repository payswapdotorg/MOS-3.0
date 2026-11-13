# mos-agent-organizations CONTRACT

## Authority

- agent-organizations（module-registry-v3.0.yaml）：AgentBody / Organization / NodeOffer
  （节点服务要约）durable 记录的唯一 authority；node/offer 记录 tenant 范围隔离（invariants §17）。
- NodeOffer 是 architecture §8 "economic and human execution" 的服务要约对象：发布是 fail-closed
  门禁——§8 披露不全的 offer 只能停留在 draft（invariants §14，最终守卫 assertNodeOfferPublishable）。
- 假设交接缝（W2-A）：本模块只为能力主张携带证据（AgentBody.evidenced_capability_ids /
  NodeOffer.evidence_refs 是不透明引用），绝不记录实验结果——实验结果归 Experiment authority（决策锁 #18）。
- capability 引用是不透明 id 字符串（capability_id），不导入 @mos/capabilities（W2-A 决议；
  module-registry depends_on 的对账与 gate wiring 归 TL 所有）。
- 不拥有任何 ZCode 权威；不存任何密钥/凭据（原始密钥归既有 credential store，invariants §8 边界）。

## Public entrypoints

- `@mos/agent-organizations` → `src/index.ts`
- `@mos/agent-organizations/contract` → `src/contract.ts`（类型窄口 + 错误再导出；不声明 store 方法）

## Intake 规则（domain/registration.ts，纯函数、零 I/O、零 Date/random）

- AgentBody / Organization 注册：逐字 intake；未提供的可空字段保持 null、数组逐字复制；
  status 不由注册命令决定（注册恒为 active）；id / created_at / updated_at 由注入 deps 提供。
- NodeOffer 草稿（nodeOfferFromDraftInput）：§8 披露字段全部显式可空——null = 未披露（绝不猜测）、
  空数组 = 显式"无"；status 恒为 draft，发布只能走 NodeOfferStore.publish 门禁。
- 产物双向守卫：先过命令 schema（agentBodyRegistrationSchema / organizationRegistrationSchema /
  nodeOfferDraftInputSchema），再过持久记录 schema（agentBodySchema / organizationSchema /
  nodeOfferRecordSchema）。

## §8 发布门禁（domain/offer-gate.ts + application/node-offer-store.ts）

missingOfferDisclosures 按 NODE_OFFER_REQUIRED_DISCLOSURES 语义逐字段判定（与
assertNodeOfferPublishable 同源；返回名单即 OfferPublishBlockedError 携带的字段名）：

| 字段 | 视为缺失 |
| --- | --- |
| capability_id | null 或纯空白 |
| deliverables / evidence_refs | null 或空数组 |
| availability | 整体 null，或 windows 与 capacity 同时 null（只披露其一即视为已披露） |
| geography / language / price_reward / deadline / sla | null |
| rights_constraints / delivery_history | null（显式空数组 = 披露"无"，不缺失） |
| acceptance_evaluator | null，或 evaluator_ref 纯空白 |

- inputs 不在 NODE_OFFER_REQUIRED_DISCLOSURES 清单内，门禁不点名它；但 published 记录必须
  符合 nodeOfferSchema（inputs 为非空类型数组）——publish 物化时 fail-closed
  （ContractValidationError），绝不静默默认。
- publish 流程：可选补丁（出现的键逐字替换、缺席的键保持原值、无默认）→ 门禁（缺失非空 →
  OfferPublishBlockedError，携带缺失字段名）→ nodeOfferSchema 物化（status=published +
  updated_at=时钟当前值）→ assertNodeOfferPublishable 最终守卫 → 持久化。
- 写边界反旁路：save 直接写入 status=published 的记录同样过门禁 + 最终守卫——披露不全的
  offer 不可能经任何写路径变成 published。
- withdraw 幂等：已 withdrawn 的记录不再写入、不改时间戳；撤回后的要约不再出现在 published 列表，
  可重新补齐披露后再走门禁发布。

## Stores（application/*，tenant-scoped、文件后端、原子写）

- 单文件 JSON（mos-agent-bodies.json / mos-organizations.json / mos-node-offers.json，W1
  mission-store 同构）：原子写（同目录 tmp + rename）；文件缺失 → 空启动（durable =
  跨进程重启可读）；结构与 schema 损坏 fail-closed（ContractValidationError）。
- AgentBodyStore / OrganizationStore：save（逐字 upsert，不改时间戳）/ get / listByTenant；
  写入先过各自 schema（失败抛类型化 AgentBodyValidationError / OrganizationValidationError）
  再过 assertTenantScope；get 对不存在的 id 抛类型化 NotFoundError，记录存在但属于其他租户时
  由 assertTenantScope 拒绝（InvariantViolation，绝不当作"不存在"处理）。
- NodeOfferStore 额外提供：publish / withdraw / listPublishedByCapability——后者只返回该
  tenant 的 status=published 且 capability_id 精确匹配的记录（draft / withdrawn / expired
  绝不作为可用要约出现），published 记录读取时再次过 nodeOfferSchema（损坏 fail-closed，
  绝不表面化）；publish / withdraw 用注入时钟（TimeSource，缺省 SystemTimeSource）推进
  updated_at。
- offer 持久记录是 nodeOfferSchema 的超集（nodeOfferRecordSchema：draft 阶段 §8 字段可保持
  null）；该 schema 不带任何 default——文件格式全显式，缺键即校验失败（读边界绝不静默补全）。

## Layers

- `contract.ts` / `contract/{agent-body,organization,node-offer}.ts`：类型、词表、schema 与类型化错误。
- `domain/{registration,offer-gate,offer-patch}.ts`：纯函数（零 I/O、零 Date/random；now/id 注入）。
- `application/*`：文件持久化与发布/撤回编排（node:fs 只出现在这一层）。

## 状态（AGENTS.md §7 词汇）

- contract-tested：注册/门禁/store 行为经契约测试覆盖；与组合根/事件流的挂接属后续阶段
  （deferred：本包暂不发射 DomainEvent——durable 记录即 authority，事件流接线归 TL 所有）。

## 消费方

- mos-lab（program discovery 只引用既有 offer 记录）、mos-resource-network（W4 节点发现）、
  组合根（TL 所有）。
