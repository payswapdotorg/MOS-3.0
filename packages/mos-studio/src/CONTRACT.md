# mos-studio CONTRACT

## Authority

- studio 组合根（module-registry-v3.0.yaml：mos-studio）。本模块是 TL 拥有的 central composition root：
  把 mos-* 各 authority 模块组合成 New Task → Mission → capabilities → routes → authorized read 的完整旅程。
- 本模块不拥有任何领域 authority：missions/integrations/capabilities/routes 各归其模块；
  这里只做组合、投影与真实栈注入。
- ZCode 会话/任务体系仍是消息与通用任务状态的唯一权威（AGENTS.md §2 / preservation contract）；
  New Task 控件绝不替换/隐藏/改名（本模块零核心文件改动，插件形态纯增量）。

## Public entrypoints

- `@mos/studio` → `src/index.ts`
- `@mos/studio/contract` → `src/contract.ts`（类型窄口；不声明接口/类方法）

## 形态：ZCode 插件（纯增量挂载，零核心文件改动）

- `.zcode-plugin/plugin.json`：`mos-studio`；`mcpServers.studio`（stdio，node dist/server.mjs）；
  `ui.surfaces[0]`（`ui://mos-studio/panel.html`，availability=session，server=studio）；
  顶层 `slots`（`nav.primary` + `sidePane.launcher` → surface；Desktop-only，Web 端按上游行为自然降级为普通工具记录）。
- `hooks/hooks.json`：`SessionStart` → `node ${ZCODE_PLUGIN_ROOT}/dist/hook.mjs`（timeoutMs 5000，onError allow）。
  只有 `source=startup`（新任务首个回合）视为任务创建事实；resume/fork/clear/compact 跳过。
- 安装：上游 `plugins.dirs`（inline，defaultEnabled）或本地 marketplace；宿主对插件 server/hook 注入
  `ZCODE_PLUGIN_DATA` / `ZCODE_PLUGIN_ROOT` 等 env overlay；工具调用 `_meta` 携带 session/workspace 事实。
- Desktop 渲染面板（MCP Apps 沙箱）；Web 端无 pluginSandbox 端口 → 插件工具按上游既有行为渲染为普通
  MCP 工具记录（`PluginUiToolCallBlock` fallback；无 MOS 侧工作）。

## 数据落点（$ZCODE_PLUGIN_DATA，全部原子写）

- `mos-missions.json`（@mos/missions MissionStore）、`mos-connections.json`（@mos/integrations
  ConnectionStore）、`mos-operator.json`（OperatorStore）。
- 授权材料绝不落这里：Composio key 只进真实共享 ZCode 凭据存储（不透明引用
  `mcp:apikey:composio-studio:header`）；连接记录只存不透明 credential_ref。

## 操作者声明（诚实的 user 事实）

- 插件面（hook payload / 工具 `_meta`）没有 ZCode 账户 user id 事实。组合根不发明身份：
  操作者经面板一次性声明（`mos_set_operator`，app-only），`loginProvider` 固定
  `mos_operator_declaration`（声明即声明，绝不冒充 ZCode 账户事实）。未声明 → tenant 解析
  fail-closed（sidecar 记 resolve_tenant 失败，工具返回类型化错误）。

## 工具（server/studio-server.ts；业务失败 isError 结构化返回，绝不裸抛）

- `mos_studio_status`（模型+页面）：operator/tenant/session/linked mission/connections/availability。
- `mos_set_operator`（app-only）、`mos_connect_composio`（app-only；key 只进真实凭据端口，绝不回显）、
  `mos_execute_authorized_read`（app-only；operator-initiated，read-only）。
- `mos_list_missions`、`mos_record_mission_intake`（面板表单=人的逐字输入通道，零推断）、
  `mos_capabilities`、`mos_routes`（模型+页面，全部只读）。

## 授权读纪律（application/studio-service.ts）

- 顺序：tenant → 连接（typed ConnectionNotFoundError）→ 能力实例 available（否则 blocked +
  missing_preconditions）→ 凭据缺失 → Composio session 工厂（REST；@mos/integrations schema）→
  全新真实 MCP 客户端（http + x-api-key 运行时注入）→ `COMPOSIO_MULTI_EXECUTE_TOOL` →
  `HACKERNEWS_SEARCH_POSTS` → counts/shapes 证据（`summarizeProviderReadResult`；绝不复制记录内容）。
- 失败分类：`classifyProviderError` + `providerErrorAction`（unauthorized → invalidate 等矩阵同 W1）。

## 真实栈接线与 typecheck 约定（src/runtime/*）

- `src/runtime/{main,real-stack}.ts` import `@zcode/adapters`（真实 ZCode MCP 客户端
  `createMcpAdapter` + 真实共享加密凭据存储 `createSharedZCodeCredentialStore`）——组合根专属合法依赖。
- 依赖 CLI dist 导出 → **默认 typecheck 排除 `src/runtime` 与 `test/integration`**（tsconfig.json exclude）；
  `tsconfig.integration.json` + `pnpm --filter @mos/studio typecheck:integration` 覆盖，
  运行前提 `pnpm --filter @zcode/adapters... build`（与 @mos/adapters test/integration 同约定；
  fresh-clone 教训见 PR #3）。esbuild 构建（scripts/build.mjs）不做 typecheck。
- 真实栈验证：`pnpm --filter @mos/studio build` 后 `test/integration/plugin-real-stack.test.ts`
  （spawn dist/server.mjs 过真实 createMcpAdapter stdio + 真实凭据存储 + 上游真实清单解析）；
  `test/integration/composio-live-journey.test.ts`（env COMPOSIO_API_KEY，无 key 跳过）。

## 面板（src/ui/*）

- `model.ts` 纯状态机（工程测试 `test/panel-model.test.ts`）；`host.ts` ext-apps AppBridge；
  `main.tsx` + `panel.html`（宿主 MCP Apps CSS 变量；构建内联 `/*__SCRIPT__*/`）。
- 可用性语义镜像 packages/ui/src/mos-extension（host → switch → mission 门序与原因词汇）：
  镜像而非 import（深导入宿主 ui 包违反治理；host-tree 挂载仍 deferred，语义一致性由
  `test/availability.test.ts` 保证）。

## Layers

- `contract/`（zod 镜像 schema + 词汇）、`domain/`（纯投影/可用性语义，零 IO）、
  `application/`（组合服务 + 存储与 provider I/O 端口）、`server|hook|runtime|ui`（组合面 glue，
  不参与 layer 规则，同 module.ts/index.ts 待遇）。

## Status（AGENTS.md §7 词汇）

- contract-tested（工程套件）+ 真实栈集成证据（test/integration，包内运行；见 IMPLEMENTATION-STATE 记录）。
- Desktop 可视挂载（面板在真实 Desktop 宿主中的渲染）与 desktop E2E：blocked（本沙箱无 docker/显示；
  与 Week 1-3 相同的环境 blocker）。HubSpot：维持 blocked/unknown（无账户；证据记录不变）。
