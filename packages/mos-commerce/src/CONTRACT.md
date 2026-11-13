# mos-commerce 契约说明

**Authority:** commerce（module-registry-v3.0.yaml；Week 4 —— model/engine economy
and network capacity，architecture §8/§9/§12）。

## 公开入口

- `src/index.ts`（完整 API）与 `src/contract.ts`（类型窄口 + 类型化错误）。

## 层次

- `contract/`：产品/定价/情报写入 schema、生命周期词表、类型化错误。
- `domain/`：纯函数 —— 产品物化与状态机、定价物化/重叠检测/退定（§24 append-only）、
  情报物化（§25 证据门禁）。
- `application/`：持久 tenant-scoped 存储（JSON 文件、原子写、fail-closed 读取）。

## 硬性 fail-closed 规则

- 定价历史 append-only（§24）：价格金额/模型/生效窗口创建后零更新 API；
  替代 = 追加新记录 + 旧记录 retire（superseded_by 指针）；被替换记录落盘前过
  §24 终守卫（hand-built 改写也会被拒）。
- 同产品同模型 active 窗口重叠 → `PriceConflictError`（绝不静默覆盖）。
- 情报证据门禁（§25）：`evidence_refs` min(1)（schema 层）+ 落盘终守卫；
  `subject_ref` 不透明（记录内零 PII）；facts 原样承载（零推断）。
- 租户边界：跨租户读写一律 `InvariantViolation`。
- 存储损坏（非法 JSON / 结构破坏 / schema 不符）= `ContractValidationError` 拒读；
  未知键容忍（additive 契约演化）。
- 零 provider I/O、零支付/交易执行；artifact/证据引用一律不透明。

## 已知边界

- 定价执行/收费归既有 Zcode runtime（本包只承载记录与状态）；
- 情报证据到 provider 读记录的组合根接线属后续里程碑。
