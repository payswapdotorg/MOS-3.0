# Architecture Change Record — ACR-0002

**Status:** accepted

**Owner:** TL (payswapdotorg)
**Date:** 2026-11-14
**Related PR / issue:** Issue #24；PR "feat(mos): Muse Code (local CLI) delegated execution backend"
**Affected modules/contracts:** `packages/provider`（provider data schema / access & api 联合 / registry 序列化）、`apps/zcode-cli/packages/adapters`（新增 `src/model/muse/`）、`apps/zcode-cli/packages/bootstrap`（`ApiProviderModelRuntime` 分流、`create-app` 装配）、`packages/services` + `packages/shared` + `packages/client` + `packages/ui`（MuseCliDetection 服务与 Settings 状态卡）、`config/provider/zcode-builtin.json`（revision 45）。

## Context

Issue #24：用户已经在本机安装并登录了 Meta 的 **Muse Code CLI**（订阅含 Contributor 模式），要求能在 MOS 的 Model Settings 里选择它，并在普通 New Task / Composer 里使用，**不经 OpenRouter、不创建按量付费 API Key**。

已核实的 Meta 边界（dev.meta.ai，2026-11-14）：

1. Muse Code CLI 是第一方 agent，`muse serve` 通过 **Muse Session Protocol (MSP)** 在 stdio 上提供会话宿主；官方 `@muse-code/sdk`（npm，与 CLI 版本锁步）是公开支持的驱动接口。
2. 订阅额度**只**作用于 CLI 自己的登录凭证；另行创建的 Meta Model API Key 一律按量计费。`muse-spark-1.3-contributor` / `muse-spark-1.2-contributor` 是 Contributor 模式的模型 ID。
3. `muse usage --json`、`muse login`、`muse logout`、`muse --version` 是 documented 命令面，可作为无凭证探测/连接操作。

## Current locked decision

- Provider 执行链只有三种 HTTP api 类型（`anthropic-messages` / `openai-chat-completions` / `openai-responses`），全部经 Vercel AI SDK 工厂（`model-execution.ts`）。
- Access 只有 `api-key` 族与 `zhipu-account` 族；完整 Provider 必须有 baseUrl 与凭证。
- `AGENTS.md` §4：未经 ACR 不得新增 model router / tool executor / provider SDK 层；Provider I/O 只能在 Integration/adapter 层。

## Proposed decision

新增 **Muse Code 本地执行后端（delegated execution backend）**，按既有 Provider 注册表与模型工厂接入，**不是**第二个 model router，也**不是**普通推理 Provider：

1. **api 类型 `muse-session-protocol`**：新增枚举值；其完整配置只有 `{type}`（无 baseUrl/headers）。稀疏编辑形态保持单一对象、type 可缺省（既有 sparseShape 语义不变）；complete 校验为按 type 判别的联合，muse 分支拒绝多余字段（fail-closed）。
2. **access 类型 `muse-cli-local`**：无字段。MOS 不保存任何凭证——运行时借用本机已登录 CLI 的会话与订阅额度；检测与登录/登出全部通过 documented CLI 命令（Host 侧 `IMuseCliDetectionService`：`muse --version` / `muse usage --json` / `muse login` / `muse logout`），**不读取、不复制、不解析 CLI 的凭证存储**。
3. **执行适配**：`ApiProviderModelRuntime.#createRegistryModel` 在 AI SDK 工厂**之前**按 `isMuseSessionProtocolApi(provider.config.api)` 分流到 `MuseSessionModelAdapter`（`apps/zcode-cli/packages/adapters/src/model/muse/`，官方 `@muse-code/sdk` 唯一依赖，精确锁 1.4.20）。其余注册表、选择、会话、投影、Studio 链路不变。
4. **回合模型（v1，无状态）**：每个 MOS 模型请求 = 一个新 MSP session + 一个 Muse 回合；宿主 `muse serve` 进程级懒启动共享。对话历史以转录形式随请求重发（系统提示被有意丢弃：Muse 携带自己的 agent 上下文）。这保证 rewind/retry/换 Provider 不受外部会话状态牵连，且不在 Adapter 层维护 MOS↔Muse 会话映射。已知代价：每回合重发上下文 + Muse 观察者 token 开销（文档已记录）；按 MOS 会话固定 MSP session 留作后续项。
5. **工具语义（防双环）**：Muse 的工具活动是 **provider 侧已执行** 的事实，映射为 `tool_input_start(providerExecuted)` + `provider_tool_result` 投影；本后端**永不**产生 MOS 侧 `tool_call` 事件，MOS 工具环不参与执行。MOS 的工具契约随请求传入但不转发（capability 声明保持 `supportsToolCall: true` 以免普通会话被本地校验拒绝——该声明描述“参与携带工具的会话”的能力，文档记录其语义）。
6. **审批桥（唯一控制点）**：MSP approval 请求由 MOS 决策。默认策略 `deny`（选择服务端给出的拒绝/中止选项；无拒绝选项时返回不存在的 choiceId，由 SDK 守卫拒绝发送、审批保持挂起落到宿主 default-deny）。显式环境变量 `ZCODE_MUSE_TOOL_APPROVAL=allow-once` 时仅放行 `decision=approved && scope=once` 且 subject kind ∈ {shell, fileAccess, network, process} 的选项；protectedWrite 与未知 kind 一律拒绝；绝不选择 session/localPersistent 级授权。决策本身以 `provider_tool_result`（`kind: "muse-approval"`）投影进会话流，保持可见性。交互式审批 UI 桥接为后续项。
7. **中止/生命周期**：`ModelRequest.abortSignal` → `turn.interrupt()` + 立即抛出中止原因（AI SDK 同语义；abort 是泵的竞争赛道之一，长工具回合下不悬挂）。宿主死亡 → 连接重置，下次请求重连。会话关闭路径释放 Muse session（`leave()`）。
8. **catalog（revision 45）**：模板 `muse-code-cli`（7 个成员：spark 1.1–1.3 + contributor 变体 + wonder + ember；`modelApiRules` 以 `apiTypeMatch: muse-session-protocol` 限定，reasoningLevel 为 CLI 的 8 档封闭词表 `none…ultra`，maxOutputTokens 上限 64000）与模板 `meta-model-api`（**按量付费**，openai-chat-completions，`https://api.meta.ai/v1`，名称与 UI 文案明确标注 pay-as-you-go，与 CLI 订阅路径区分）。
9. **连通性测试**：复用既有 `testModelConnectivity`（一次极小的真实回合 = 真实证据）；无模型调用的状态探测由 Settings 状态卡承担。

## Impact analysis

- **ZCode preservation / existing feature impact**: 三个 HTTP api 类型与两种既有 access 的 schema、校验、序列化、执行路径行为不变（序列化按 type 分支后对既有类型逐字段等价；`toAiSdkProviderConfig` 对 muse 先拒绝，运行时因分流永不到达）。既有模板/模型规则不受影响（muse 规则以 apiTypeMatch 限定，不触碰 opencode-zen 的 `muse-spark-1.2-contributor-free`——其 api 类型不同）。
- **New Task / Composer / shell impact**: 无协议/UI 改动——muse Provider 经由既有 `ModelSelection` 选择，composer 模型菜单自动出现；回合内文本/推理/工具活动按既有投影渲染。
- **Runtime, permission, plugin, model or workflow authority**: 权限权威不变。MOS 工具环不执行 muse 工具；外部 agent 的文件/命令活动被限制在 `startSession.workspaceRoot`（= 该 workspace 的 app 工作目录），审批桥是唯一授权控制点。
- **Domain module authority and dependency graph**: `@muse-code/sdk` 仅出现在 `apps/zcode-cli/packages/adapters`；MOS 域包、services、ui 不接触 SDK（域代码零 provider SDK 调用，符合 §4）。
- **Data model, migration and historical compatibility**: schema 改动全部加法（枚举值 + 联合分支）；`zcode-builtin.json` revision 44→45；无迁移。
- **Provider API, credential and tenant/privacy impact**: MOS 不保存、不转发、不解析 Muse 凭证；Settings 探测只返回版本/登录态/订阅额度事实。Contributor 模式的数据使用条款由 Meta 与用户的订阅关系约束，MOS 不替用户开启或关闭该模式（不设置 `MUSE_CONTRIBUTOR_MODE`）。
- **Security, trust and sandbox impact**: 不提取/复用隐藏 token；不使用 `--yolo` 或关闭 CLI sandbox；不绕过计划限制。默认拒绝审批 + workspace 限定 + fail-closed（未知 api 类型在 AI SDK 工厂前拒绝）。
- **Cost, latency, quotas and operational impact**: 使用用户的 Muse Code 订阅额度（非 MOS 侧 API Key）。`muse serve` 为懒启动子进程；每回合一个 MSP session。观察者 agent 增加订阅侧 token 用量（Meta 文档）。
- **Web, desktop and remote client impact**: 后端在 CLI 进程内（desktop/web 同构）；Settings 状态卡在 renderer 经由既有服务通道消费。

## Implementation and migration

- `packages/provider`：`provider-data-schema.ts`（http/muse api 联合 + muse access）、`provider-config.ts`（`MuseLocalAccessConfig`、overlay 分支、`isMuseSessionProtocolApi`）、`schema.ts`（工厂分支）、`rule-data-schema.ts`（模板 access 联合）、`resolver.ts`（registry 类型 + 序列化分支）。
- `apps/zcode-cli/packages/adapters/src/model/muse/`：`muse-host.ts`（宿主管理/重置/注入工厂）、`muse-request-mapper.ts`（回合输入渲染 + effort 档位）、`muse-event-mapper.ts`（item/delta/completed → ModelStreamEvent 归约）、`muse-approval-policy.ts`（决策纯函数）、`muse-session-model.ts`（适配器 + 执行器 + 泵）、`muse-detection.ts`（CLI 命令探测 + SDK 深探测）。
- `apps/zcode-cli/packages/bootstrap`：`provider-registry-model-runtime.ts`（分流）、`create-app.ts`（装配 + 释放）。
- `packages/shared`/`services`/`client`/`ui`：`MuseCliDetection` 服务通道 + 实现 + 状态卡（W1 workstream）。
- `config/provider/zcode-builtin.json` + `.test.json`：模板与规则（同 revision 同步）。

## Tests and evidence

- 契约测试（`apps/zcode-cli/packages/adapters/tests/muse/`，39 例）：事件归约（含真实 conformance transcript 字面量）、审批决策边界（deny 兜底、once 限定、protectedWrite/未知 kind 拒绝、无拒绝选项时不猜）、请求渲染（单消息直传/历史转录/截断/无用户消息拒绝）、执行器回合（文本流 + usage 映射、失败终态、中止 interrupt+抛出、宿主启动失败归一、generateText 累积）。**均为 scripted fake 的 contract tests；不构成真实 provider 集成证明**（AGENTS §4 语言：contract-tested）。
- Registry 模拟（PR 描述内含命令与输出）：模板 → personal 实例 → 7/7 模型 executable/selectable，序列化 `{"type":"muse-session-protocol"}`、`{"type":"muse-cli-local"}`。
- 真实端到端（Issue #24 §5 的 8 步 Windows 验证）**待用户在 Windows x64 机器执行**：见 `docs/model-provider-muse-cli.md` 验证清单。本 ACP 的状态在该证据落地前保持 contract-tested + integrated，不升级为 verified。

## Rollback

单 PR 反转：删除 `muse/` 目录与 Settings 卡、还原 schema/catalog（revision 回退或前进均可，registry 只读未知 revision 时按既有容错处理）、bootstrap 分流与 create-app 装配。无数据迁移、无持久化格式变更。

## Approval

- TL: payswapdotorg（本 ACR 作者）
- Required domain/security reviewers: 待 PR 评审（安全关注点：外部 agent 子进程边界、审批默认拒绝、无凭证触碰——见 Impact analysis）
- Commit / PR that updates architecture lock and module registry: `architecture-policy.yaml` 例外 `muse-code-cli-delegated-backend-new-module`（新增文件在未受管 zcode-cli 树内的唯一登记点；不新增 managed 模块）。
