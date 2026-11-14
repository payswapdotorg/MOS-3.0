# Muse Code（本地 CLI）执行后端 — 运维与验证手册

对应 ACR-0002 / Issue #24。MOS 通过官方 `@muse-code/sdk`（Muse Session Protocol, MSP）驱动**本机已登录的 Muse Code CLI**，把用户的 Muse Code 订阅额度（含 Contributor 模式）作为 New Task 的执行后端。**不是** OpenAI 兼容推理端点，不使用 OpenRouter，不创建按量付费 API Key。

## 前置条件（用户机器）

1. 安装 Muse Code CLI（≥1.4.20）：
   - macOS/Linux：`curl -fsSL https://dev.meta.ai/install.sh | bash`
   - Windows PowerShell：`irm https://dev.meta.ai/install.ps1 | iex`
2. 终端运行一次 `muse`，选择 **Sign in with your browser** 完成登录（或 Settings 卡上的 Connect）。
3. （可选）确认订阅与 Contributor 模式：`muse usage`；Contributor 开关在交互会话 `/settings → Model → Contributor mode`。MOS **不代改**该设置。
4. 非默认安装路径时，设置 `ZCODE_MUSE_CLI_PATH` 指向 muse 可执行文件（Host 探测与 CLI 后端都会读取）。

## 在 MOS 中使用

1. Settings → Model Providers → Add provider → 选择 **Meta Muse Code (local CLI, subscription)**。
2. 该 Provider **不需要任何 API Key**。状态卡显示：CLI 版本、登录态、订阅额度（`muse usage --json` 投影）、以及"本地 CLI 订阅额度，非 API Key、非 OpenRouter"的说明；Recheck / Connect / Disconnect 分别对应探测 / `muse login` / `muse logout`。
3. New Task / Composer 的模型菜单选择 `muse-spark-1.3-contributor`（或其他成员），正常发送任务。

## 行为语义（v1，详见 ACR-0002）

- **回合模型**：每个 MOS 模型请求 = 一个全新 MSP session + 一个 Muse 回合；`muse serve` 子进程懒启动、进程内共享、宿主死亡自动重连。Muse 会话的活动范围限定在该 workspace 根目录。
- **消息映射**：单条用户消息原文直传（首轮与 CLI 行为一致）；多轮时先渲染"更早对话"转录再给当前请求；ZCode 系统提示不转发（Muse 自带 agent 上下文）。
- **工具活动**：Muse 的工具在 provider 侧执行，以 provider-executed 工具行 + 结果投影进会话视图；MOS 自己的工具环不参与（无 MOS 侧 tool_call）。
- **审批（默认拒绝）**：外部 agent 请求工具授权时，MOS 默认选择**拒绝**，Muse 会收到拒绝结果并继续。需要真实有界工具操作时，为应用进程设置 `ZCODE_MUSE_TOOL_APPROVAL=allow-once`：仅放行"单次（scope=once）、已知类别（shell/fileAccess/network/process）"的批准选项；受保护写入与未知类别始终拒绝。每次决策都会在会话流中留下一行 `muse-approval` 证据。
- **中止**：Composer 的停止手势 → `turn.interrupt()` + 流立即终止（与既有 Provider 中止语义一致）。
- **用量**：usage 在回合终态映射（cached → cacheRead, reasoning 单列）。每次回合（包括 Settings 的 Test connection）会消耗少量订阅 token；Muse 自带的观察者 agent 也会计入订阅用量（Meta 文档）。

## 与 Meta Model API（按量付费）的区别

模板 **Meta Model API (pay-as-you-go)** 是独立的 OpenAI 兼容模板（`https://api.meta.ai/v1`，需要自建 API Key，按 token 计费）。它存在且仅用于显式选择按量付费路线；UI 文案明确标注，且**不会**被描述为使用 CLI 订阅额度。

## Windows 验证清单（Issue #24 §5，验收必需）

在用户的 Windows x64 机器上（MOS 桌面版 + 已登录的 Muse Code CLI）：

1. Settings → 选择 **Meta Muse Code**；确认状态卡显示 CLI 版本、已登录、订阅额度。
2. `muse usage` 与状态卡一致；Contributor 模式开启时模型菜单包含 `-contributor` 变体。
3. New Task 发送一个普通任务（如"总结这个仓库"）：验证流式文本、回合完成、会话正常收尾。
4. 设置 `ZCODE_MUSE_TOOL_APPROVAL=allow-once` 后发送一个**有界工具任务**（如"运行测试并总结失败"）：验证工具活动行 + `muse-approval` 证据行 + 真实工具结果。
5. 任务运行中点 Stop：验证回合立即停止（无悬挂进程；`muse sessions --json` 不残留）。
6. 重启 MOS：Provider 仍然可用（MOS 未复制任何 CLI 秘密；登录态属于 CLI）。
7. 抓包或日志确认：**无 OpenRouter 流量**、无 Meta API Key 出现在配置/环境/日志中。
8. 收集证据：`muse --version`、MOS 版本、脱敏 JSONL 样例（一轮含审批、一轮含工具）、截图、`muse usage` 前后对比；更新 `docs/handoff/IMPLEMENTATION-STATE.md` 并把状态升级为 verified。

## 故障排查

| 症状 | 判定 | 处置 |
| --- | --- | --- |
| 状态卡 "not installed" | PATH 上无 muse | 安装或设 `ZCODE_MUSE_CLI_PATH`，Recheck |
| 状态卡 "not signed in" | `muse usage` 报 not logged in | Connect（或终端 `muse login`）后 Recheck |
| 回合失败 `Muse Code CLI host failed to start (spawnFailed)` | 路径/权限 | 校验可执行文件路径 |
| 回合失败 `launchError`（含 not logged in 类信息） | CLI 未登录/订阅不可用 | 登录或检查订阅 |
| 工具全部被拒 | 默认 deny 策略 | 显式设置 `ZCODE_MUSE_TOOL_APPROVAL=allow-once` |
| Test connection 消耗额度 | 设计如此（真实最小回合） | 状态卡探测（`muse usage`）不消耗模型回合 |

## 工程边界（实现者须知）

- `@muse-code/sdk` 只允许出现在 `apps/zcode-cli/packages/adapters/src/model/muse/`（精确锁版本，与 CLI 同版本号锁步升级）。
- Host 侧探测（`IMuseCliDetectionService`）只用 documented CLI 命令，不用 SDK、不触碰凭证存储。
- 已知后续项：按 MOS 会话固定 MSP session（省 token）、交互式审批 UI 桥、`muse sessions` 侧的进程治理面板、`maxOutputTokens` 传递到 MSP 回合。
