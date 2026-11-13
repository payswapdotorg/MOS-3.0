# mos-learning CONTRACT

## Authority

- learning（module-registry-v3.0.yaml）：校准（calibration）与建议（recommendation）
  记录的 authority；从**已验证证据**（concluded 且带测量证据的实验）派生。
- 不变量 §23（core-contracts-v3.0.yaml）：CalibrationRecord 只引用带证据的收尾实验；
  **delayed-mode 恒为 true**（共享 schema z.literal(true)）——本包只是建议记录的
  authority，绝不提供任何修改 routes / production / 实验的 API（实时自动应用被
  契约层排除）。
- 决策锁 #18：结果归 Experiment authority；本包只消费实验结果事实（经结构化端口），
  不写任何实验字段。

## Public entrypoints

- `@mos/learning` → `src/index.ts`
- `@mos/learning/contract` → `src/contract.ts`（类型窄口 + 类型化错误 + Store）

## Layers

- `contract/calibration.ts`：CalibrationIntake（写入口；调用方不可表达
  delayed_mode=false）+ ExperimentLookup 结构化端口 + CalibrationSourceError。
- `domain/calibration.ts`：来源门禁纯函数（实验必须存在/concluded/带测量证据，
  缺口 → 具名 reason 的 CalibrationSourceError，fail-closed）+ 记录物化
  （delayed_mode 恒 true）。
- `application/calibration-store.ts`：tenant-scoped 单 JSON 文件存储
  （原子写 tmp+rename）；校准记录不可覆盖（同 id → 校验错误，新校准用新 id）；
  跨租户记录不可见。

## 硬规则（fail-closed）

- 来源门禁：experiment_not_found / not_concluded / no_measurement_evidence 三种
  具名拒绝；绝不降级为"空校准"。
- delayed-mode：schema 层锁死；包内零执行/零修改 API。
- 证据引用逐字保留；未知字段走 additive 容忍（存储读路径），schema 损坏 fail-closed。
