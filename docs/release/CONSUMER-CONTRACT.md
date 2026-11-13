# MOS 消费者下载契约（本地 AI 代理安装规范）

**目的**：本地 AI 代理是 MOS 桌面产品的**纯消费者**——只下载、校验、安装、启动。它不构建任何东西。

**发布页**：`https://github.com/payswapdotorg/MOS-3.0/releases`

## 1. 允许的操作（按序）

1. **查询 Release 元数据**：取最新 stable（`/releases/latest`）或显式指定版本的 RC；读取 Release 资产中的 `release-manifest.json`。
2. **探测主机**：OS（Windows/macOS/Linux）与 CPU 架构（x64/arm64）。
3. **选择安装器**：在 manifest 的 `targets` 里选择**唯一**匹配 `os`+`arch` 的 required 安装器（每平台首选格式：Windows `exe`，macOS `dmg`，Linux `AppImage`；`deb` 为替代）。
4. **下载**：安装器 + `SHA256SUMS`（同一 Release 资产）。
5. **校验 SHA-256**：对下载文件重算哈希，与 `SHA256SUMS` 和 manifest 的 `sha256` 双向一致；不一致即终止并报告。
6. **安装**（需要管理员权限时征得用户授权）：
   - Windows：运行 NSIS `exe`（普通安装向导；无人值守可 `/S`）；
   - macOS：打开 `dmg`，拖入 Applications（未签名 RC：首次启动右键 → 打开）；
   - Linux：`chmod +x MOS-<version>-linux-x64.AppImage && ./MOS-...AppImage`，或 `sudo apt install ./MOS-<version>-linux-x64.deb`。
7. **启动并报告**：启动 MOS；报告安装的版本（manifest `version`）、来源 commit（`sourceCommit`）、包哈希、安装结果。

## 2. 禁止的操作

- 克隆仓库、安装 Node/pnpm、编译任何代码、创建 MOS Studio 插件；
- 手工编辑用户配置（如 `plugins.dirs`）来"启用"内置插件——MOS 安装包已内置并默认启用；
- 静默替换已有 ZCode 安装（MOS 与上游 ZCode 并排安装，互不触碰数据）；
- 在校验失败或目标缺失时继续安装。

## 3. 机器可读依据

- `release-manifest.json`：`version`、`tag`、`sourceCommit`、`zcodeBaseline`、`channel`（`rc`/`stable`）、`targets[]`（`os`/`arch`/`format`/`filename`/`sizeBytes`/`sha256`/`required`）、`omittedTargets[]`、`signature.status`。
- 仓库附带选择器参考实现：`scripts/release/select-installer.mjs`（`--manifest release-manifest.json --detect`）。

## 4. 向代理移交的最小信息

仓库（`payswapdotorg/MOS-3.0`）+ 目标（最新 stable 或指定 RC）+ 主机 OS/架构。其余全部由 Release 资产自描述。
