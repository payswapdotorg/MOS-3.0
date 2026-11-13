#!/usr/bin/env node
/**
 * 消费端安装包选择（简单下载契约，backlog §7）。
 *
 * 本地 agent 只拿 release-manifest.json + 宿主 os/arch（或 --detect 自动探测），
 * 选出唯一一个兼容的必选安装包并输出下载 URL + SHA-256。mac 上 dmg/zip 都必选时优先 dmg
 * （OS 常规安装机制），linux 上 AppImage 优先于 deb；无法唯一定位时失败而不是猜。
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MOS_PLATFORMS,
  PRIMARY_FORMAT_BY_OS,
  detectHostOsArch,
  platformKeyForOsArch,
} from "./artifacts.mjs";
import { parseReleaseCliArgs, printUsageAndExit } from "./cli-args.mjs";
import { validateReleaseManifest } from "./manifest.mjs";

const USAGE =
  "select-installer.mjs --manifest <file> (--detect | --os <mac|win|linux> --arch <x64|arm64>) " +
  "[--releases-base <https://github.com/<owner>/<repo>/releases/download>]\n" +
  "输出唯一匹配安装包的 JSON：{ filename, sha256, sizeBytes, downloadUrl }；" +
  "downloadUrl = <releases-base>/<tag>/<filename>。";

/**
 * 从 manifest 选择唯一安装包。os/arch 必须是登记矩阵内的组合；releasesBase 可选
 * （缺省时不输出 downloadUrl，纯库内使用）。
 */
export function selectInstallerFromManifest(manifest, { os, arch, releasesBase } = {}) {
  const problems = validateReleaseManifest(manifest);
  if (problems.length) {
    throw new Error(`manifest 校验失败：\n- ${problems.join("\n- ")}`);
  }
  if (!MOS_PLATFORMS[platformKeyForOsArch(os, arch)]) {
    throw new Error(`未登记的目标 ${os}-${arch}`);
  }
  const candidates = manifest.targets.filter(
    (target) => target.os === os && target.arch === arch && target.required,
  );
  if (!candidates.length) {
    throw new Error(`manifest 中没有 ${os}-${arch} 的必选安装包`);
  }
  const primary = PRIMARY_FORMAT_BY_OS[os];
  const preferred = candidates.filter(
    (target) => target.format.toLowerCase() === primary.toLowerCase(),
  );
  // 主格式（mac=dmg / win=exe / linux=AppImage）优先；否则仅当候选唯一时返回。
  const chosen = preferred[0] ?? (candidates.length === 1 ? candidates[0] : null);
  if (!chosen) {
    throw new Error(
      `无法唯一定位 ${os}-${arch} 安装包，候选：${candidates.map((target) => target.filename).join(", ")}`,
    );
  }
  return {
    filename: chosen.filename,
    sha256: chosen.sha256,
    sizeBytes: chosen.sizeBytes,
    format: chosen.format,
    downloadUrl: releasesBase
      ? `${releasesBase.replace(/\/+$/u, "")}/${manifest.tag}/${chosen.filename}`
      : undefined,
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, {
      required: ["manifest"],
      optional: ["detect", "os", "arch", "releases-base"],
    });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) return printUsageAndExit(USAGE);
  try {
    if (!args.detect && (!args.os || !args.arch)) {
      throw new Error("需要 --detect 或同时提供 --os 与 --arch");
    }
    const manifest = JSON.parse(await readFile(resolve(args.manifest), "utf8"));
    const host = args.detect ? detectHostOsArch() : { os: args.os, arch: args.arch };
    const selection = selectInstallerFromManifest(manifest, {
      os: host.os,
      arch: host.arch,
      releasesBase: args["releases-base"],
    });
    // 单行 JSON，便于 agent/脚本直接消费。
    console.log(JSON.stringify(selection));
    return 0;
  } catch (error) {
    console.error(`[select-installer] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
