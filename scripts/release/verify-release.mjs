#!/usr/bin/env node
/**
 * 发布终验：对产物目录（或发布资产 URL）重算 SHA-256，核对 manifest 与 SHA256SUMS。
 *
 * 本地模式：--artifacts-dir 内必须存在 manifest 列出的全部文件，逐个重算哈希与大小。
 * 下载模式：--download <releases-download-base> 时走纯 HTTPS fetch（无认证）下载每个资产并
 * 重哈希，模拟 clean-client 校验（backlog §6.1：下载后先验 SHA-256 再安装）。
 * 任何不一致（哈希、大小、SHA256SUMS 行、必选目标缺失）都退出码 1；不修补、不跳过。
 */

import { createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { MOS_PLATFORMS } from "./artifacts.mjs";
import { parseReleaseCliArgs, printUsageAndExit } from "./cli-args.mjs";
import { parseSha256sums, sha256File } from "./checksums.mjs";
import { validateReleaseManifest } from "./manifest.mjs";

const USAGE =
  "verify-release.mjs --artifacts-dir <dir> --manifest <file> [--download <releases-download-base>]\n" +
  "下载模式示例 --download https://github.com/payswapdotorg/MOS-3.0/releases/download/mos-v3.0.0-rc.1\n" +
  "（base 即资产 URL 中文件名之前的全部前缀；SHA256SUMS 与各安装包都从该前缀下载后重算哈希）";

const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

async function downloadToFile(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`只接受 HTTPS 下载地址：${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

export async function verifyRelease({ artifactsDir, manifestPath, downloadBaseUrl }) {
  const problems = [];
  const root = resolve(artifactsDir);
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  problems.push(
    ...validateReleaseManifest(manifest, { expectedPlatforms: Object.keys(MOS_PLATFORMS) }),
  );

  // 下载模式先落盘再哈希：产物体积大，直接流式进 hash 也行，但落盘可以顺带核对字节大小。
  for (const target of manifest.targets) {
    const localPath = join(root, target.filename);
    try {
      if (downloadBaseUrl) {
        await downloadToFile(
          `${downloadBaseUrl.replace(/\/+$/u, "")}/${target.filename}`,
          localPath,
        );
      }
      const info = await stat(localPath);
      if (info.size !== target.sizeBytes) {
        problems.push(`${target.filename} 大小不一致：manifest=${target.sizeBytes} 实际=${info.size}`);
      }
      const actual = await sha256File(localPath);
      if (actual !== target.sha256) {
        problems.push(`${target.filename} SHA-256 不一致：manifest=${target.sha256} 实际=${actual}`);
      }
    } catch (error) {
      problems.push(`${target.filename} 无法获取/哈希：${error.message}`);
    }
  }

  // SHA256SUMS 与 manifest 必须完全一致（集合相等），而不是只做子集校验。
  try {
    const sumsText = downloadBaseUrl
      ? await (await fetch(`${downloadBaseUrl.replace(/\/+$/u, "")}/SHA256SUMS`, {
          signal: AbortSignal.timeout(60_000),
        })).text()
      : await readFile(join(root, "SHA256SUMS"), "utf8");
    const lines = parseSha256sums(sumsText);
    const byFilename = new Map(lines.map((line) => [line.filename, line.sha256]));
    for (const target of manifest.targets) {
      if (!byFilename.has(target.filename)) {
        problems.push(`SHA256SUMS 缺少 ${target.filename}`);
      } else if (byFilename.get(target.filename) !== target.sha256) {
        problems.push(`SHA256SUMS 中 ${target.filename} 的哈希与 manifest 不一致`);
      }
    }
    const manifestFilenames = new Set(manifest.targets.map((target) => target.filename));
    for (const line of lines) {
      if (!manifestFilenames.has(line.filename)) {
        problems.push(`SHA256SUMS 多出 manifest 未登记的文件：${line.filename}`);
      }
    }
  } catch (error) {
    problems.push(`SHA256SUMS 无法读取（下载或本地）：${error.message}`);
  }

  return { problems, manifest };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, {
      required: ["artifacts-dir", "manifest"],
      optional: ["download"],
    });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) return printUsageAndExit(USAGE);
  try {
    const { problems, manifest } = await verifyRelease({
      artifactsDir: args["artifacts-dir"],
      manifestPath: args.manifest,
      downloadBaseUrl: args.download,
    });
    if (problems.length) {
      console.error(`[verify-release] 发布终验失败（${problems.length} 个问题）：`);
      for (const problem of problems) console.error(`  - ${problem}`);
      return 1;
    }
    console.log(`[verify-release] ${manifest.version}：${manifest.targets.length} 个产物哈希/大小/清单全部一致`);
    return 0;
  } catch (error) {
    console.error(`[verify-release] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
