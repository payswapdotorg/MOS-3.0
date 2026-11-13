# RC 验收清单（clean-machine acceptance）

对照 `spec/backlog/release-engineering.md` §6 的 10 项验收，逐项标注自动化证据与人工项。**自动化项由 `mos-release.yml` 的 smoke 作业产出证据；人工项在发布评审时完成并记录。**

| # | 验收项（backlog §6） | 自动化证据（smoke 步骤） | 人工项 |
|---|---|---|---|
| 1 | 下载资产并校验 SHA-256 | CI 内置（`verify-release` 全量复算 + smoke `verify-artifact` 步）；发布后建议另跑 `verify-release --download`（干净客户端） | 可选复核 |
| 2 | 用操作系统常规机制安装（不跑 pnpm/Node/构建脚本） | smoke `install` 步骤（dpkg/apt、hdiutil+ditto、NSIS `/S`；目标机=CI runner，无源码 checkout） | 无 |
| 3 | OS 身份/包元数据/图标/可执行名均为 MOS 且不与上游冲突 | smoke `identity` 步骤（dpkg -s 名称=mos、Info.plist bundle id=org.payswap.mos、安装目录 MOS.exe/mos） | 桌面环境图标目测（runner 无完整桌面） |
| 4 | 安装后可启动；整机/应用重启后可再启动 | smoke `launch` 步骤（启动→等待 userData→终止→**二次启动**）；"整机重启"需真机 | 真机重启复验 |
| 5 | 安装包包含并自动加载 MOS Studio（manifest/hook/MCP server/面板/原生闭包） | smoke `plugin-seeded` + `plugin-alive` + `session-hook` 步骤（seed 缓存断言、MCP initialize+tools/list+tools/call 全链路、重写后 hook 经 shell 原样执行） | 无 |
| 6 | 未连接 Provider 时安全降级（会话/mission 上下文可用，能力项为空） | smoke `plugin-alive` 的 `mos_studio_status` 无凭据返回即断言降级语义 | UI 面板目测（runner 无显示） |
| 7 | 原生 ZCode New Task/Composer、模型选择、终端等全功能保留 | 打包链路保证（production/preview 行为零改动；`mos-ci.yml` 全量工程门禁）；冒烟只覆盖安装面 | 桌面端手工旅程回归（评审人本机安装） |
| 8 | MOS 禁用/插件故障时普通 New Task 仍可用 | 设计保证（hook `onError: allow`；插件失败不阻塞会话） | 手工验证一次（禁用 mos-studio 后创建普通任务） |
| 9 | MOS 数据跨重启/升级持久；已装 ZCode profile 不受触碰 | smoke `data-persistence` + `upgrade`（`--upgrade-artifact` 时）+ `upstream-decoys-untouched`（诱饵 `~/.zcode` 全程快照比对）；同版本 RC 的 upgrade 步显式记 skipped | 跨版本升级留待 rc.2 发布时执行 |
| 10 | 测试日志/包检查/OS 信息存档；不含凭据 | 证据 JSON（`smoke-evidence-<platform>.json`）+ 构建日志随 Release 归档；冒烟不接触任何凭据 | 无 |

**安装包内容检查**（backlog §6.5 的包内面）由 `scripts/release-smoke/inspect-package.mjs` 在 build 作业内执行维度断言（asar、插件闭包、原生二进制、命名、无 latest.yml/blockmap 残留）。

**发布评审最低门槛**：4 平台 smoke 证据全部 `ok: true`（degraded 需逐条说明）；manifest 与 SHA256SUMS 复算一致；omittedTargets 已在说明中声明；未签名状态已明示。
