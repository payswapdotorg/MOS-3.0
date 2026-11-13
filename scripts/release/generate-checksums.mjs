#!/usr/bin/env node
/**
 * 生成 SHA256SUMS（sha256sum 兼容格式，`<hex>  <filename>`）。
 *
 * 只对符合 MOS 安装包命名（MOS-<version>-<os>-<arch>.<ext>）的文件计算，
 * 避免把 release-manifest.json / notes 等元数据文件误当发布资产；行序按文件名排序，
 * 输出可复现。发布前哈希必须在最终包字节定稿后生成（backlog §4）。
 */

import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseMosArtifactFilename } from "./artifacts.mjs";
import { parseReleaseCliArgs, printUsageAndExit } from "./cli-args.mjs";
import { generateSha256sums } from "./checksums.mjs";

const USAGE =
  "generate-checksums.mjs --artifacts-dir <dir> [--out <file>]\n" +
  "默认 out = <artifacts-dir>/SHA256SUMS；只收集 MOS-<version>-<os>-<arch>.<ext> 命名的安装包。";

async function listMosArtifacts(artifactsDir) {
  const entries = await readdir(artifactsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseMosArtifactFilename(entry.name);
    if (!parsed) continue;
    const info = await stat(join(artifactsDir, entry.name));
    if (!info.isFile()) continue;
    files.push({
      filename: entry.name,
      path: join(artifactsDir, entry.name),
      sizeBytes: info.size,
    });
  }
  // 排除 out 文件自身（比如旧 SHA256SUMS 被误放进产物目录时也不能进入哈希列表）。
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  if (!files.length) {
    throw new Error(`目录 ${artifactsDir} 中没有 MOS 命名的安装包产物`);
  }
  return files;
}

export async function generateChecksumsFile({ artifactsDir, outPath }) {
  const files = await listMosArtifacts(artifactsDir);
  const text = await generateSha256sums(
    files.map((file) => ({ path: file.path, filename: file.filename })),
  );
  const target = resolve(outPath);
  await writeFile(target, text, "utf8");
  return { outPath: target, count: files.length };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, { required: ["artifacts-dir"], optional: ["out"] });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) return printUsageAndExit(USAGE);
  try {
    const result = await generateChecksumsFile({
      artifactsDir: args["artifacts-dir"],
      outPath: args.out ?? join(args["artifacts-dir"], "SHA256SUMS"),
    });
    console.log(`[generate-checksums] ${result.count} 个产物 → ${basename(result.outPath)}`);
    return 0;
  } catch (error) {
    console.error(`[generate-checksums] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
