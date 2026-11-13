#!/usr/bin/env node
/**
 * 生成发布说明（release notes）。
 *
 * 内容契约（spec/backlog/release-engineering.md §4、§5 与任务说明）：
 * - 版本、来源提交 SHA、ZCode 上游基线、构建运行链接；
 * - 每个目标的安装说明（linux chmod+x / apt install；mac dmg 拖入 Applications、zip 解压；win 运行 exe）；
 * - 未签名状态如实声明 + macOS Gatekeeper / Windows SmartScreen 指引（不声称签名、公证或可信）；
 * - 自动更新已刻意禁用的手动更新路径（绝不指向上游 ZCode feed）；
 * - 显式省略的目标（win-arm64 / linux-arm64）与已知限制；
 * - 冒烟证据摘要（按 smoke-evidence JSON 的实际字段如实汇总，不虚构字段）；
 * - 校验和验证指引（sha256sum -c SHA256SUMS）。
 * 除非 manifest 的 attestationStatus 为 generated，否则不写任何 attestation 断言。
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MOS_PLATFORMS } from "./artifacts.mjs";
import { parseReleaseCliArgs, printUsageAndExit } from "./cli-args.mjs";
import { validateReleaseManifest } from "./manifest.mjs";

const USAGE =
  "generate-release-notes.mjs --manifest <file> --out <notes.md> [--evidence-dir <dir>]\n" +
  "evidence-dir 内的 smoke-evidence-*.json 按实际字段汇总为证据条目。";

function formatBytes(sizeBytes) {
  const mebibytes = sizeBytes / (1024 * 1024);
  return `${(mebibytes / 1024).toFixed(2)} GiB (${sizeBytes.toLocaleString("en-US")} bytes)`;
}

function installInstructions(target) {
  switch (`${target.os}/${target.format}`) {
    case "linux/AppImage":
      return `\`chmod +x ${target.filename}\` 后直接运行 \`${target.filename}\`（无需安装）。`;
    case "linux/deb":
      return `\`sudo apt install ./${target.filename}\`（Debian/Ubuntu）。`;
    case "linux/rpm":
      return `\`sudo dnf install ${target.filename}\`（RHEL/Fedora）。`;
    case "linux/pkg.tar.zst":
      return `\`sudo pacman -U ${target.filename}\`（Arch）。`;
    case "mac/dmg":
      return `打开 \`${target.filename}\`，把 MOS 拖入 Applications。`;
    case "mac/zip":
      return `\`unzip ${target.filename}\` 后把 MOS.app 拖入 Applications（供自动化/工具链使用）。`;
    case "win/exe":
      return `运行 \`${target.filename}\`（NSIS 安装器，可选择安装目录）。`;
    default:
      return `使用操作系统的常规方式安装 \`${target.filename}\`。`;
  }
}

/**
 * 单条冒烟证据的摘要行。证据 schema 由 scripts/release-smoke（Worker C）所有，
 * 这里只对常见字段做防御性提取，取不到就明确写"见原始 JSON"，绝不虚构结论。
 */
function evidenceLine(filename, json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return `- \`${filename}\`：非 JSON 对象，请查看原始证据文件`;
  }
  const bits = [];
  const platform = json.platform ?? json.target ?? json.platformKey;
  if (platform) bits.push(`platform=${platform}`);
  const status =
    json.status ??
    json.result ??
    (typeof json.passed === "boolean" ? (json.passed ? "passed" : "failed") : undefined);
  if (status) bits.push(`status=${status}`);
  const version = json.mosVersion ?? json.appVersion ?? json.version;
  if (version) bits.push(`version=${version}`);
  const sha256 = json.sha256 ?? json.artifact?.sha256 ?? json.installer?.sha256;
  if (sha256) bits.push(`sha256=${sha256}`);
  if (!bits.length) {
    return `- \`${filename}\`：证据 JSON 已归档（无已知汇总字段，请查看原始文件）`;
  }
  return `- \`${filename}\`：${bits.join(", ")}`;
}

async function readEvidenceFiles(evidenceDir) {
  if (!evidenceDir) return [];
  let entries;
  try {
    entries = await readdir(evidenceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      summaries.push(
        evidenceLine(
          entry.name,
          JSON.parse(await readFile(join(evidenceDir, entry.name), "utf8")),
        ),
      );
    } catch {
      summaries.push(evidenceLine(entry.name, null));
    }
  }
  summaries.sort();
  return summaries;
}

export async function renderReleaseNotes({ manifest, evidenceDir }) {
  const problems = validateReleaseManifest(manifest);
  if (problems.length) {
    throw new Error(`manifest 校验失败：\n- ${problems.join("\n- ")}`);
  }
  const lines = [];
  const channelLabel = manifest.channel === "rc" ? "Release Candidate" : "Stable";
  lines.push(`# MOS ${manifest.version} (${channelLabel})`);
  lines.push("");
  lines.push(`- **Tag:** \`${manifest.tag}\``);
  lines.push(`- **Source commit:** \`${manifest.sourceCommit}\``);
  lines.push(`- **ZCode upstream baseline:** \`${manifest.zcodeBaseline}\`（MOS 版本独立于导入的上游基线）`);
  lines.push(`- **Built at:** ${manifest.builtAt}`);
  lines.push(`- **Build run:** ${manifest.buildRunUrl}`);
  lines.push("");
  lines.push("## Downloads");
  lines.push("");
  lines.push("| Platform | Format | Required | File | Size | SHA-256 |");
  lines.push("|---|---|---|---|---|---|");
  for (const target of manifest.targets) {
    lines.push(
      `| ${target.platform} | ${target.format} | ${target.required ? "yes" : "best-effort"} | \`${target.filename}\` | ${formatBytes(target.sizeBytes)} | \`${target.sha256}\` |`,
    );
  }
  lines.push("");
  lines.push("## Install");
  lines.push("");
  for (const platform of Object.keys(MOS_PLATFORMS)) {
    const targets = manifest.targets.filter((target) => target.platform === platform);
    if (!targets.length) continue;
    lines.push(`### ${platform}`);
    lines.push("");
    for (const target of targets) {
      lines.push(`- **${target.format}** — ${installInstructions(target)}`);
    }
    lines.push(`- Minimum OS: ${targets[0].minOs}`);
    lines.push("");
  }
  lines.push("## Verify the download (SHA-256)");
  lines.push("");
  lines.push("下载 `SHA256SUMS` 与安装包放在同一目录后：");
  lines.push("");
  lines.push("```bash");
  lines.push("sha256sum -c SHA256SUMS        # Linux");
  lines.push("shasum -a 256 -c SHA256SUMS    # macOS");
  lines.push("# Windows PowerShell: Get-FileHash <installer> -Algorithm SHA256");
  lines.push("```");
  lines.push("");
  lines.push("## Signature status: UNSIGNED (this RC)");
  lines.push("");
  lines.push(
    `- This build is **unsigned**: ${manifest.signature.reason}. There is no code signing, ` +
      "no macOS notarization and no Windows Authenticode signature on any installer.",
  );
  lines.push(
    "- macOS Gatekeeper will block the first launch: right-click the app and choose **Open**, or use " +
      "System Settings → Privacy & Security → **Open Anyway**. Only bypass Gatekeeper for artifacts you " +
      "verified against `SHA256SUMS` above.",
  );
  lines.push(
    "- Windows SmartScreen may show \"Windows protected your PC\": choose **More info → Run anyway** after " +
      "verifying the SHA-256.",
  );
  lines.push(
    "- Build provenance attestation status: " +
      `**${manifest.signature.attestationStatus}** ` +
      "(recorded from the workflow run; this note makes no further claims).",
  );
  lines.push("");
  lines.push("## Updates");
  lines.push("");
  lines.push(
    "- Auto-update is **intentionally disabled** for MOS: there is no update feed, and MOS never reads or " +
      "writes an upstream ZCode installation or its update manifests.",
  );
  lines.push(
    "- To update, download the next release from the [releases page](https://github.com/payswapdotorg/MOS-3.0/releases) " +
      "and install it with the operating system's normal installer; the MOS profile is preserved across upgrades.",
  );
  lines.push("");
  lines.push("## Omitted targets");
  lines.push("");
  for (const omitted of manifest.omittedTargets) {
    lines.push(`- **${omitted.target}**: ${omitted.reason}`);
  }
  lines.push("");
  lines.push("## Smoke test evidence");
  lines.push("");
  const evidence = await readEvidenceFiles(evidenceDir);
  lines.push(...(evidence.length ? evidence : ["- 无冒烟证据文件（发布工作流未提供 evidence-dir）"]));
  lines.push("");
  lines.push("## Known limitations");
  lines.push("");
  for (const limitation of manifest.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function generateReleaseNotesFile({ manifestPath, outPath, evidenceDir }) {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const text = await renderReleaseNotes({ manifest, evidenceDir });
  const target = resolve(outPath);
  await writeFile(target, text, "utf8");
  return target;
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, {
      required: ["manifest", "out"],
      optional: ["evidence-dir"],
    });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) return printUsageAndExit(USAGE);
  try {
    const target = await generateReleaseNotesFile({
      manifestPath: args.manifest,
      outPath: args.out,
      evidenceDir: args["evidence-dir"],
    });
    console.log(`[generate-release-notes] 发布说明已生成：${target}`);
    return 0;
  } catch (error) {
    console.error(
      `[generate-release-notes] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
