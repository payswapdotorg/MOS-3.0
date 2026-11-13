#!/usr/bin/env node
/**
 * 生成 release-manifest.json（schema 见 scripts/release/manifest.mjs）。
 *
 * 输入是发布 job 汇总后的产物目录：只接受 MOS 命名、与 --version 一致的安装包；
 * 每个产物重算 size + SHA-256，必选/尽力而为标记按 scripts/release/artifacts.mjs 矩阵编码。
 * 生成后立即做 validateReleaseManifest 自检，问题必须在本步暴露而不是等上传之后。
 */

import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MIN_OS_BY_OS,
  platformKeyForOsArch,
  isProductionMosArtifact,
  parseMosArtifactFilename,
} from "./artifacts.mjs";
import { parseReleaseCliArgs, printUsageAndExit } from "./cli-args.mjs";
import { sha256File } from "./checksums.mjs";
import { buildReleaseManifest, validateReleaseManifest } from "./manifest.mjs";
import { parseMosVersion } from "./mos-version.mjs";

const USAGE =
  "generate-release-manifest.mjs --artifacts-dir <dir> --out <file> --version <semver> " +
  "--source-commit <sha> --zcode-baseline <version> --build-run-id <id> --build-run-url <url> " +
  "[--tag mos-v<semver>] [--built-at <iso>] [--attestation-status generated|failed|skipped]";

/**
 * 从产物目录构建 manifest 所需的 artifacts 列表（size+hash 现场重算）。
 * 文件名里的版本必须与 --version 完全一致：目录里混入其它版本即失败（防止矩阵错配）。
 */
export async function collectManifestArtifacts({ artifactsDir, version }) {
  const entries = await readdir(artifactsDir, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseMosArtifactFilename(entry.name);
    if (!parsed) continue;
    if (!isProductionMosArtifact(parsed)) {
      throw new Error(`产物 ${entry.name} 不是生产 MOS 安装包命名，拒绝进入 manifest`);
    }
    if (parsed.version !== version) {
      throw new Error(`产物 ${entry.name} 的版本 ${parsed.version} 与发布版本 ${version} 不一致`);
    }
    const info = await stat(join(artifactsDir, entry.name));
    if (!info.isFile()) continue;
    artifacts.push({
      platform: platformKeyForOsArch(parsed.os, parsed.arch),
      os: parsed.os,
      arch: parsed.arch,
      format: parsed.format,
      filename: entry.name,
      sizeBytes: info.size,
      sha256: await sha256File(join(artifactsDir, entry.name)),
      minOs: MIN_OS_BY_OS[parsed.os],
    });
  }
  if (!artifacts.length) throw new Error(`目录 ${artifactsDir} 中没有 MOS 安装包产物`);
  return artifacts;
}

export async function generateReleaseManifestFile({
  artifactsDir,
  outPath,
  version,
  tag,
  sourceCommit,
  zcodeBaseline,
  buildRunId,
  buildRunUrl,
  builtAt,
  attestationStatus,
}) {
  const parsed = parseMosVersion(version);
  const artifacts = await collectManifestArtifacts({ artifactsDir, version: parsed.version });
  const manifest = buildReleaseManifest(
    {
      version: parsed.version,
      tag: tag ?? parsed.tag,
      sourceCommit,
      zcodeBaseline,
      buildRunId,
      buildRunUrl,
      builtAt,
      attestationStatus,
    },
    artifacts,
  );
  const problems = validateReleaseManifest(manifest);
  if (problems.length) {
    throw new Error(`release manifest 校验失败：\n- ${problems.join("\n- ")}`);
  }
  const target = resolve(outPath);
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, {
      required: [
        "artifacts-dir",
        "out",
        "version",
        "source-commit",
        "zcode-baseline",
        "build-run-id",
        "build-run-url",
      ],
      optional: ["tag", "built-at", "attestation-status"],
    });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) return printUsageAndExit(USAGE);
  try {
    const manifest = await generateReleaseManifestFile({
      artifactsDir: args["artifacts-dir"],
      outPath: args.out,
      version: args.version,
      tag: args.tag,
      sourceCommit: args["source-commit"],
      zcodeBaseline: args["zcode-baseline"],
      buildRunId: args["build-run-id"],
      buildRunUrl: args["build-run-url"],
      builtAt: args["built-at"],
      attestationStatus: args["attestation-status"],
    });
    console.log(
      `[generate-release-manifest] ${manifest.version}（${manifest.channel}）targets=${manifest.targets.length} → ${args.out}`,
    );
    for (const target of manifest.targets) {
      console.log(`  ${target.platform}: ${target.filename}（required=${target.required}）`);
    }
    return 0;
  } catch (error) {
    console.error(
      `[generate-release-manifest] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
