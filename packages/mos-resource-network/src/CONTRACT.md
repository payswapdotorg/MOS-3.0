# mos-resource-network 契约说明

**Authority:** resource-network（module-registry-v3.0.yaml；Week 4 —— model/engine economy
and network capacity，architecture §8/§12）。

## 公开入口

- `src/index.ts`（完整 API）与 `src/contract.ts`（类型窄口 + 类型化错误）。

## 层次

- `contract/`：写入 schema、生命周期词表、类型化错误、跨模块发现端口
  （`OfferLookup` / `EngineLookup` —— 组合根解析到 agent-organizations / engines）。
- `domain/`：纯函数 —— 节点物化、gig 状态机（§8 发布门禁 + §23 人工指派门禁）、
  §8 路线比较推荐、容量发现（matched/excluded 具名浮出）。
- `application/`：持久 tenant-scoped 存储（JSON 文件、原子写、fail-closed 读取）。

## 硬性 fail-closed 规则

- 人工指派（§23）：human 节点指派必须携带路线比较 —— 覆盖 agent/engine 与
  no-op/reuse 候选、无一 adequate（unknown 也不算）、带证据引用；§8 包披露
  （deadline / budget_reward / expected_value_of_waiting / alternative_route_ids）
  齐全才可发布。缺任何一项 = 具名类型化错误，绝不静默放行。
- 发现（§26）：被排除容量（inactive 节点、draft/withdrawn/expired 要约、
  deprecated/unknown 引擎）必须带具名原因浮出，绝不静默过滤。
- 租户边界：跨租户读写一律 `InvariantViolation`。
- 存储损坏（非法 JSON / 结构破坏 / schema 不符）= `ContractValidationError` 拒读；
  未知键容忍（additive 契约演化）。
- 零 provider I/O、零 engine 调用、零执行原语；引用一律不透明 id 字符串。

## 已知边界

- `OfferLookup` / `EngineLookup` 的组合根接线（studio 面板/服务层）属后续里程碑；
- gig 的交付/验收执行归既有 Zcode runtime（外部引用），本包只承载业务状态。
