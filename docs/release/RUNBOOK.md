# MOS 桌面发布操作手册（release runbook）

**适用范围**：`payswapdotorg/MOS-3.0` 的 MOS 桌面产品发布（tag `mos-v*`）。上游 ZCode 同步是独立的源码变更工作流，不在本手册范围。

## 1. 角色分工

- **TL + 仓库 CI**：构建、打包、校验、起草 Release、发布。全部构建发生在 GitHub Actions 原生 runner 上，任何本地机器不产出发布物。
- **发布评审人（产品所有者）**：审阅 draft Release 的产物与验收证据后批准发布。
- **本地 AI 代理（消费者）**：只做「查询 Release 元数据 → 下载安装器 → 校验 SHA-256 → 安装 → 启动」。见 [CONSUMER-CONTRACT.md](./CONSUMER-CONTRACT.md)。

## 2. 版本与 tag 规则

- Tag 形态：`mos-v<semver>`，例如 `mos-v3.0.0-rc.1`（RC）/ `mos-v3.0.0`（stable）。
- MOS 版本独立于导入的 ZCode 上游基线（当前 3.18.0）；两者都记录在 `release-manifest.json`。
- **禁止**使用上游形态 tag（`v3.18.x`）—— `mos-release.yml` 的 release-gate 会在这种 tag 上直接失败。
- 已发布 tag 不可变更。修正性重建必须使用新版本新 tag，绝不覆盖已发布产物。

## 3. 发布流程

1. **前置**：目标 commit 已合入 `main`（release-gate 校验 `git merge-base --is-ancestor`）。
2. **触发**（二选一）：
   - 打 tag 推送：`git tag mos-v3.0.0-rc.1 <main 上的 commit> && git push origin mos-v3.0.0`；
   - 或 Actions 页面手动 dispatch `mos-release.yml`，输入 `mos_version`（gate 会在当前 main HEAD 建 tag）。
3. **CI 流水线**（`mos-release.yml`，全链路见 workflow 文件头注释）：
   - `release-gate`：tag 归属校验、版本解析、上游基线读取；
   - `build`（4 目标矩阵）：linux-x64（ubuntu-24.04，AppImage+deb）、mac-arm64（macos-15，dmg+zip）、mac-x64（macos-15-intel，dmg+zip）、win-x64（windows-2022，exe）；MOS 构建环境 `ZCODE_ENV=production MOS_PRODUCT_IDENTITY=1 ZCODE_DESKTOP_APP_VERSION=<version>`；构建后自动 `collect-artifacts`（缺必需产物即失败）并上传构建日志；
   - `smoke`（每平台原生 runner）：下载本平台安装器，运行 `scripts/release-smoke/run-platform-smoke.mjs` —— 安装、MOS 身份断言、启动/重启、内置 mos-studio 插件 seed/存活/SessionStart hook、上游 ZCode 诱饵不受触碰；产出 `smoke-evidence-<platform>.json`；
   - `release`：汇总产物 → `SHA256SUMS` + `release-manifest.json` → `verify-release` 全量复算 → `gh release create --draft` 上传全部资产与说明 → 构建出处证明（best-effort，结果如实记录）。
4. **评审**：TL 从 draft Release 页面核对资产清单、校验和、证据 JSON；如需干净客户端复核：
   ```bash
   node scripts/release/verify-release.mjs --artifacts-dir <空目录> \
     --manifest release-manifest.json \
     --download https://github.com/payswapdotorg/MOS-3.0/releases/download/mos-v<version>
   ```
5. **发布（唯一方式，人工执行）**：
   ```bash
   gh release edit mos-v<version> --draft=false
   ```
   流水线绝不自动 publish。

## 4. 未签名构建注意事项

当前 RC 无签名凭据（manifest `signature.status = "unsigned"`）：

- macOS：首次打开需右键 → 打开（Gatekeeper 未知开发者提示），或在系统设置里放行；
- Windows：SmartScreen 可能弹出「更多信息 → 仍要运行」；
- Linux：AppImage 需要 `chmod +x`；deb 安装不受签名影响。

发布说明由 `generate-release-notes.mjs` 自动携带以上提示。**禁止**在无凭据时声称 signed/notarized/trusted；RC 是显式声明的预览身份。

## 5. 已声明未支持的目标

- Windows arm64、Linux arm64：待原生/运行时冒烟验证后加入矩阵（见 `release-manifest.json` 的 `omittedTargets`）。
- 自动更新：MOS 不接任何 feed（上游 feed 与占位 localhost 均被禁止）。更新路径 = 手动下载下一个 Release 安装。

## 6. 回滚与修正

- 发布后发现缺陷：**新版本新 tag**（如 `mos-v3.0.0-rc.2`），旧 Release 保留并在 notes 中标注已知问题；
- draft 阶段发现缺陷：删除 draft（`gh release delete mos-v<version> --yes` + 删 tag），修复后重新打 tag；
- 绝不 `--clobber` 已发布资产；绝不移动已发布 tag。

## 7. 验收记录

每次发布把以下证据归档到 draft Release 资产与 `docs/handoff/IMPLEMENTATION-STATE.md`：

- `smoke-evidence-<platform>.json` ×4；
- `SHA256SUMS`、`release-manifest.json`；
- 构建日志（workflow run 链接）；
- 手工验收项的记录（见 [ACCEPTANCE-RC.md](./ACCEPTANCE-RC.md)）。
