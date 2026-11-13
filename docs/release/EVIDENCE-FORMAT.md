# Release 证据格式（evidence formats）

MOS 发布链路产出三类机器可读证据。三者都以 Release 资产归档，`docs/handoff/IMPLEMENTATION-STATE.md` 引用其结论。

## 1. `release-manifest.json`（`scripts/release/manifest.mjs` schema v1）

```jsonc
{
  "schemaVersion": 1,
  "product": "MOS",
  "version": "3.0.0-rc.1",            // MOS 发布版本（独立于上游基线）
  "tag": "mos-v3.0.0-rc.1",
  "sourceCommit": "<40 位完整 SHA>",   // tag 指向的 main 历史内 commit
  "zcodeBaseline": "3.18.0",           // 导入的 ZCode 上游基线（根 package.json version）
  "buildRunId": "<GITHUB_RUN_ID>",
  "buildRunUrl": "<GITHUB_SERVER_URL>/<repo>/actions/runs/<id>",
  "builtAt": "<ISO 8601>",
  "channel": "rc",                     // rc | stable（semver 预发布后缀 → rc）
  "signature": {
    "status": "unsigned",              // 未配置签名凭据时的诚实状态
    "reason": "no signing credentials configured for this RC",
    "attestationStatus": "generated|failed|not-attempted"  // 构建出处证明（best-effort，如实记录）
  },
  "targets": [
    {
      "platform": "linux-x64",
      "os": "linux",                   // 消费者契约字段：linux | mac | win
      "arch": "x64",                   // x64 | arm64
      "format": "AppImage",           // AppImage | deb | dmg | zip | exe | rpm | pkg.tar.zst
      "filename": "MOS-3.0.0-rc.1-linux-x64.AppImage",
      "sizeBytes": 123456789,
      "sha256": "<hex>",
      "required": true,                // 该平台必备产物；false = best-effort（rpm/pkg.tar.zst）
      "minOs": "glibc 2.28+"           // mac "13.0.0" / win "Windows 10+"
    }
  ],
  "omittedTargets": [
    { "target": "win-arm64", "reason": "pending native/runtime smoke verification" },
    { "target": "linux-arm64", "reason": "pending native/runtime smoke verification" }
  ],
  "limitations": ["auto-update disabled; manual download path only"]
}
```

校验规则（`validateReleaseManifest` + `verify-release.mjs`）：所有 required 目标齐全、每个 target 的 filename 与 `MOS-<version>-<platform>-<arch>.<ext>` 命名契约一致、sha256/sizeBytes 与磁盘复算一致、SHA256SUMS 行与 manifest 双向一致。

## 2. `scripts/release-smoke` 证据 JSON

两套冒烟共用一套步骤语义：`passed`（全断言通过）、`failed`（粘滞，任一断言失败）、`skipped`（按契约显式跳过，例如同版本 RC 不做升级验收——绝不伪造通过）、`degraded`（环境缺件降级完成，如 runner 缺 xvfb 时的启动检查，需人工补验）。

### 2.1 `inspect-package`（构建机，包内面）

`{ schema: "mos-release-smoke/inspect-package@1", platform, artifacts: [{ file, sizeBytes, sha256, checks: {...} }], ok, failures: [] }`

### 2.2 `run-platform-smoke`（目标机，安装面）

`{ schema: "mos-release-smoke/run-platform-smoke@1", platform, mosVersion, workdir, selfTest, node, generatedAt, steps: [{ name, status, detail, durationMs }], ok, failures: [{ step, detail }] }`

固定步骤名与含义：`verify-artifact`、`isolate-home`、`install`、`identity`、`launch`（含二次启动）、`plugin-seeded`、`plugin-alive`（MCP initialize → tools/list → tools/call(mos_studio_status) 全链路）、`session-hook`（seed 后命令经 shell 原样执行）、`data-persistence`、`upgrade`（无 `--upgrade-artifact` 时 skipped）、`upstream-decoys-untouched`（`~/.zcode` 诱饵快照比对，证明 MOS 不触碰上游 ZCode 数据）。

`detail` 经深度/长度封顶（防把巨型日志写进证据）；证据写入原子（tmp + rename）。

## 3. `SHA256SUMS`

coreutils `sha256sum -c` 兼容格式：`<hex>  <filename>`（两个空格），每行一个发布资产（不含 SHA256SUMS/manifest 自身）。发布后独立复算（`verify-release.mjs --download` 干净客户端模式）。
