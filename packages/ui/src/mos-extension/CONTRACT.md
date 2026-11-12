# mos-extension CONTRACT

## 意图

未挂载的 MOS 界面扩展碎片（W1 阶段产物）：把「mission sidecar 状态」以一枚 fail-closed 的
ghost chip 暴露给未来的组合根。本模块今天**不**被任何入口 import——挂载点、locale、
architecture-policy.yaml 登记都由 TL 在组合阶段接线（deferred）。

## 公开入口

- `index.ts`：完整公共 API（契约类型、domain 判定、store 工厂、注册接缝、chip）。
- `contract.ts`：类型窄口（不含方法声明、不做 IO）。

## 层序与依赖方向

- `domain/`：纯函数（availability 判定、status→tone/label 映射与可见性决策）。不 import
  react/zustand，不做 IO。
- `app/`：`createMosExtensionStore()`——zustand vanilla store 工厂（`createStore`），只持
  「最近一份快照」的数据面 + `applySnapshot`/`reset` 两个动作。不做订阅、不做 IO。
- `adapters/`：注册接缝（`registerMosExtension`/`unregisterMosExtension`/
  `getMosExtensionRegistration`），模块级单注册位 Map。
- `components/`：`MosStatusChip`——memo 纯展示组件（span），只消费 domain 的展示模型。

## 不变量（fail-closed）

1. 未注册（`getMosExtensionRegistration()` 为 null）→ 一切按不可用渲染，chip 返回 null。
2. 宿主状态 null/未知、starting、restarting、stopped → 一律不可用（reason `host_stopped`）；
   功能可用只认 `running`。
3. 开关未开 → 不可用（`disabled`）。
4. mission 未关联 → `available=false, reason="no_mission"`，chip 显示 "MOS: idle"（可见，
   但不显示 connected）。
5. missionStatus `"error"` → warning 语气可见（错误证据不吞掉）。
6. 输入不一致时（如 available=true 但 missionStatus="unlinked"）按最保守可显示态（idle）处理，
   绝不显示 connected。
7. store 是工厂产出：无模块级单例；`applySnapshot` 只做合并，不猜值；`reset` 回到
   初始（宿主未知、开关关闭、未关联）。
8. i18n：标签暂为内联 en-US（"MOS: on"/"MOS: idle"/"MOS: error"）；locale 文案的接线与
   挂载一起 deferred，本阶段不触碰 locale 文件。

## 与其它模块的交集（hook 点）

唯一 hook 点是注册接缝 `adapters/registration.ts`：组合根调用 `registerMosExtension({store,
subscribe})` 建 store 并接线，未接线时本模块整体惰性（渲染 null）。ZCode 壳层（composer 工具栏
等）的挂载位置由组合根决定，本模块不 import 壳层，壳层今天也不 import 本模块。

## 测试

`packages/ui/test/mos-extension/`（node 环境纯逻辑）：availability / store / registration /
presentation 四组。列入 `scripts/engineering-test-files.json` 后由根 vitest 的 engineering
project 收录（TL 接线）。
