#!/usr/bin/env node
/**
 * 从 packages/desktop/dist 收集指定平台的发布产物并做机械校验。
 *
 * 规则（spec/backlog/release-engineering.md §3、§4）：
 * - 必选格式（AppImage+deb / dmg+zip / exe）缺失、或产物不足 1MB（明显不是真实安装包）→ 失败；
 * - best-effort 格式（linux rpm / pkg.tar.zst）允许缺失，收集时如实记录；
 * - 产物目录出现 latest*.yml 或 *.blockmap → 直接失败：MOS 的 publish 必须为 null，
 *   出现更新元数据说明打包配置回流到了上游 feed（见 electron-builder.config.js 的 publish 门）。
 */

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FORBIDDEN_ARTIFACT_PATTERNS,
  MOS_PLATFORMS,
  OPTIONAL_FORMATS_BY_PLATFORM,
  REQUIRED_FORMATS_BY_PLATFORM,
  formatKey,
  isProductionMosArtifact,
  parseMosArtifactFilename,
} from "./artifacts.mjs";
import { parseReleaseCliArgs } from "./cli-args.mjs";

/** 必选产物低于该体积视为异常（真实安装包为数百 MB；1MB 阈值排除占位/残缺文件）。 */
export const MIN_INSTALLER_BYTES = 1024 * 1024;

const FORBIDDEN_SUFFIX_HINT =
  "产物出现更新元数据（MOS 的 electron-builder publish 必须为 null）";

/**
 * 收集单个平台的发布产物。
 * 返回 { collected: [{ filename, format, sizeBytes, required }], missingOptional: [format...] }。
 * required 缺失、体积不足、出现禁用文件（blockmap / latest*.yml、_TEST 后缀）时抛错。
 */
export async function collectArtifacts({
  distDir,
  platform,
  requiredFormats,
  optionalFormats,
  outDir,
}) {
  if (!MOS_PLATFORMS[platform]) throw new Error(`未知发布平台：${platform}`);
  const required = requiredFormats ?? REQUIRED_FORMATS_BY_PLATFORM[platform];
  const optional = optionalFormats ?? OPTIONAL_FORMATS_BY_PLATFORM[platform] ?? [];
  const distRoot = resolve(distDir);

  let entries;
  try {
    entries = await readdir(distRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`无法读取产物目录 ${distRoot}：${error.message}`);
  }

  // 禁用文件必须整体失败，而不是只跳过被收集的文件：上游 feed 元数据出现在 MOS 构建里
  // 属于供应链约束违规（更新器可能被指向上游 ZCode feed）。
  const forbidden = [];
  const inertByproducts = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const hit = FORBIDDEN_ARTIFACT_PATTERNS.find(({ pattern }) => pattern.test(entry.name));
    if (!hit) continue;
    if (hit.inert === true) {
      // electron-builder 26 在 mac 目标上无条件生成 .blockmap（differentialPackage 选项
      // 仅存在于 NsisOptions；publish=null 也无法关闭）——没有 latest*.yml 时它是无副作用
      // 的构建残留物，不会进入发布产物集，也不能因为 electron-builder 的实现细节阻塞
      // 全部 mac 产物。nsis.differentialPackage=false 已在 Windows 侧从源头关闭。
      inertByproducts.push(`${entry.name}（${hit.label}，仅排除，不上传）`);
      continue;
    }
    forbidden.push(`${entry.name}（${hit.label}）`);
  }
  if (forbidden.length) {
    throw new Error(`${FORBIDDEN_SUFFIX_HINT}：\n- ${forbidden.join("\n- ")}`);
  }
  if (inertByproducts.length) {
    console.warn(`[collect-artifacts] 产物目录存在惰性更新残留（不收集不上传）：\n- ${inertByproducts.join("\n- ")}`);
  }

  const { os, arch } = MOS_PLATFORMS[platform];
  const wanted = new Map();
  for (const format of required) wanted.set(formatKey(format), { format, required: true });
  for (const format of optional) wanted.set(formatKey(format), { format, required: false });

  const matches = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseMosArtifactFilename(entry.name);
    if (!parsed) continue;
    if (!isProductionMosArtifact(parsed)) {
      throw new Error(`产物 ${entry.name} 带有测试后缀或非 MOS 身份，不允许进入发布产物集`);
    }
    if (parsed.os !== os || parsed.arch !== arch) continue;
    const spec = wanted.get(formatKey(parsed.format));
    if (!spec) continue;
    const fullPath = join(distRoot, entry.name);
    const info = await stat(fullPath);
    const existing = matches.get(formatKey(parsed.format));
    // 同一格式出现多份（历史构建残留）时取 mtime 最新的一份，与 bundle.mjs 的产物选择同口径。
    if (!existing || info.mtimeMs > existing.mtimeMs) {
      matches.set(formatKey(parsed.format), {
        ...spec,
        fullPath,
        filename: entry.name,
        sizeBytes: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
  }

  const missingRequired = required.filter(
    (format) => !matches.has(formatKey(format)),
  );
  if (missingRequired.length) {
    throw new Error(
      `平台 ${platform} 缺少必选产物：${missingRequired.join(", ")}（目录 ${distRoot}）`,
    );
  }
  for (const spec of matches.values()) {
    if (spec.sizeBytes <= MIN_INSTALLER_BYTES) {
      throw new Error(
        `产物 ${spec.filename} 只有 ${spec.sizeBytes} 字节（≤ ${MIN_INSTALLER_BYTES}），不像真实安装包`,
      );
    }
  }

  const outRoot = resolve(outDir);
  await mkdir(outRoot, { recursive: true });
  const collected = [];
  for (const spec of matches.values()) {
    await copyFile(spec.fullPath, join(outRoot, spec.filename));
    collected.push({
      filename: spec.filename,
      format: spec.format,
      sizeBytes: spec.sizeBytes,
      required: spec.required,
    });
  }
  collected.sort((a, b) => a.filename.localeCompare(b.filename));
  const missingOptional = optional.filter((format) => !matches.has(formatKey(format)));
  return { collected, missingOptional };
}

const USAGE =
  "collect-artifacts.mjs --dist-dir <dir> --platform <linux-x64|mac-arm64|mac-x64|win-x64> " +
  "--out-dir <dir> [--required AppImage,deb] [--optional rpm,pkg.tar.zst]\n" +
  "默认必选/尽力而为矩阵见 scripts/release/artifacts.mjs；缺失必选、体积异常或出现更新元数据时退出码 1。";

function parseFormatList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseReleaseCliArgs(argv, {
      required: ["dist-dir", "platform", "out-dir"],
      optional: ["required", "optional"],
    });
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    const result = await collectArtifacts({
      distDir: args["dist-dir"],
      platform: args.platform,
      requiredFormats: args.required ? parseFormatList(args.required) : undefined,
      optionalFormats: args.optional ? parseFormatList(args.optional) : undefined,
      outDir: args["out-dir"],
    });
    for (const format of result.missingOptional) {
      console.warn(
        `[collect-artifacts] best-effort 产物缺失（如实记录，不失败）：${args.platform} ${format}`,
      );
    }
    console.log(JSON.stringify(result.collected, null, 2));
    return 0;
  } catch (error) {
    console.error(`[collect-artifacts] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  process.exitCode = await main();
}
