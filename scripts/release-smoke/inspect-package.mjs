#!/usr/bin/env node
// inspect-package —— 构建机 post-bundle 包体检（release 冒烟第一段）。
//
// 用法：
//   node scripts/release-smoke/inspect-package.mjs --dist-dir packages/desktop/dist \
//     --platform linux-x64 --mos-version 3.0.0-rc.1 [--json evidence.json]
//
// 职责（spec/backlog/release-engineering.md §4/§6）：
// - 按 MOS-<version>-<platform>-<arch>.<ext> 命名契约定位平台必需产物（linux: AppImage+deb；
//   mac: dmg+zip；win: exe），记录 size + sha256；
// - 不完整安装的内容断言：deb 用 dpkg-deb -I/-x；AppImage 用 --appimage-extract；
//   mac 用 zip（dmg 以 size+sha256 为准）；win 用 7z 列表+定向解出；
// - 断言 app.asar 存在、MOS Studio 插件闭包完整（含目标平台 keyring 绑定包与 koffi 原生模块）、
//   Linux 可执行名 mos、deb 包名/维护者、mac Info.plist 身份；
// - 断言产物目录不带更新 feed 元数据（MOS publish 为 null，禁上游 feed/blockmap 出现在发布资产里）。
//
// 证据：{schema:"mos-release-smoke/inspect-package@1", ...}（见 docs/release/EVIDENCE-FORMAT.md）；
// 任一断言失败 → 非零退出，但证据 JSON 照常写出（含 failures 明细）。
import { mkdtemp, readdir, rm, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactFacts } from "./lib/artifact-facts.mjs";
import {
  executableFile,
  missingPaths,
  nonEmptyFile,
  pathExists,
  readJsonOrNull,
  readFileOrNull,
} from "./lib/fs-asserts.mjs";
import {
  artifactExtensionMatchesPlatform,
  expectedArtifactFileNames,
  getPlatformSpec,
  MOS_DEB_INSTALL_DIR,
  MOS_LINUX_EXECUTABLE_NAME,
  MOS_LINUX_PACKAGE_NAME,
  MOS_STUDIO_PLUGIN_RESOURCE_PATH,
  parseArtifactFileName,
  requiredStudioPluginFiles,
  resourcesDirRelativePath,
} from "./lib/platforms.mjs";
import { commandExists, firstExistingBinary, runCapture } from "./lib/spawn.mjs";

const SCHEMA = "mos-release-smoke/inspect-package@1";
const MIN_ARTIFACT_BYTES = 1024 * 1024; // 命名契约要求真实安装包；小于 1MB 必是残缺/占位产物。
const USAGE = `用法：node scripts/release-smoke/inspect-package.mjs --dist-dir <dir> --platform <linux-x64|linux-arm64|mac-x64|mac-arm64|win-x64|win-arm64> --mos-version <semver> [--json <evidence.json>]

选项：
  --dist-dir     electron-builder 产物目录（packages/desktop/dist 或按架构分桶的 dist/<arch>）
  --platform     平台目标键
  --mos-version  MOS 发布版本（如 3.0.0-rc.1；独立于上游 ZCode 3.18.x 基线）
  --json         证据 JSON 输出路径（缺省只写 stdout；建议 CI 必传并上传为构建证据）
  --help         打印本说明`;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { distDir: null, platform: null, mosVersion: null, jsonOut: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dist-dir") parsed.distDir = argv[++i];
    else if (arg === "--platform") parsed.platform = argv[++i];
    else if (arg === "--mos-version") parsed.mosVersion = argv[++i];
    else if (arg === "--json") parsed.jsonOut = argv[++i];
    else throw new Error(`未知参数：${arg}\n${USAGE}`);
  }
  if (!parsed.help) {
    for (const [name, value] of [
      ["--dist-dir", parsed.distDir],
      ["--platform", parsed.platform],
      ["--mos-version", parsed.mosVersion],
    ]) {
      if (!value) throw new Error(`缺少必填参数 ${name}\n${USAGE}`);
    }
    getPlatformSpec(parsed.platform);
  }
  return parsed;
}

/** 解析 dpkg-deb -I 输出（`Key: value` 行）。 */
export function parseDpkgInfo(text) {
  const info = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^ {2}([A-Za-z][A-Za-z0-9-]*): ?(.*)$/.exec(line) || /^([A-Za-z][A-Za-z0-9-]*): ?(.*)$/.exec(line);
    if (match && info[match[1]] === undefined) {
      info[match[1]] = match[2].trim();
    }
  }
  return info;
}

/** 解析 Info.plist（优先 plutil -p；无 plutil 时退回 XML 正则）。 */
export function parseInfoPlist(text, { mode = "xml" } = {}) {
  if (mode === "plutil") {
    const info = {};
    for (const line of String(text).split(/\r?\n/)) {
      const match = /^\s*"([^"]+)"\s*=>\s*(?:"([^"]*)"|(.+?))\s*$/.exec(line);
      if (match) info[match[1]] = match[2] ?? match[3].trim();
    }
    return info;
  }
  const info = {};
  const xml = String(text);
  const pattern = /<key>([^<]+)<\/key>\s*(?:<string>([^<]*)<\/string>|<true\/>|<false\/>)/g;
  let match = pattern.exec(xml);
  while (match) {
    info[match[1]] = match[2] ?? "";
    match = pattern.exec(xml);
  }
  return info;
}

/** 规范化 7z 列表条目路径（Windows 列表用反斜杠）。 */
export function normalizeArchiveEntryPath(entry) {
  return String(entry).replaceAll("\\", "/").replace(/^\.\//, "");
}

/** 7z 列表里是否包含全部必需条目（前缀闭包成员逐项匹配）。 */
export function sevenZipListingHasEntries(listingText, requiredEntries) {
  const listed = new Set();
  for (const line of String(listingText).split(/\r?\n/)) {
    // 7z `l` 输出：`<日期> <时间> <属性> <Size> [<Compressed>] <Name>`；
    // 目录行没有 Compressed 列，两列都按可选处理，Name 取行尾（路径可能含空格）。
    const match =
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([DRHSA.]{5})\s+(\d+)(?:\s+(\d+))?\s+(\S.*)$/.exec(
        line,
      );
    if (match) listed.add(normalizeArchiveEntryPath(match[5]));
  }
  const missing = requiredEntries.map(normalizeArchiveEntryPath).filter((entry) => !listed.has(entry));
  return { missing, listedCount: listed.size };
}

/** 扫描产物目录的更新 feed 元数据（publish:null 契约）。 */
export async function scanUpdateMetadata(distDir) {
  /** @type {string[]} */
  const updateFeedFiles = [];
  /** @type {string[]} */
  const blockmapByproducts = [];
  let entries;
  try {
    entries = await readdir(distDir, { withFileTypes: true });
  } catch {
    return { updateFeedFiles, blockmapByproducts, distDirReadable: false };
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // electron-updater 的 feed manifest 形态（latest.yml / latest-mac.yml / latest-linux.yml / beta.yml ...）。
    if (/^(latest|beta|alpha)(?:[-_][\w-]+)?\.yml$/i.test(entry.name)) {
      updateFeedFiles.push(entry.name);
    }
    if (/\.blockmap$/i.test(entry.name)) {
      blockmapByproducts.push(entry.name);
    }
  }
  return { updateFeedFiles, blockmapByproducts, distDirReadable: true };
}

function artifactFailure(failures, file, check, detail) {
  failures.push({ artifact: file, check, detail });
}

/** 插件根（<resources>/glm/packages/mos-studio-plugin）的闭包 + 清单断言。 */
async function inspectStudioPluginRoot(pluginRoot, platformKey, checks, failures, fileName, { expectSourceForm }) {
  const missing = await missingPaths(pluginRoot, requiredStudioPluginFiles(platformKey));
  const koffiNative = await nonEmptyFile(
    join(pluginRoot, "node_modules", "koffi", "build", "koffi", getPlatformSpec(platformKey).koffiPlatformKey, "koffi.node"),
  );
  checks.pluginClosure = { missing, missingCount: missing.length };
  checks.koffiNative = { exists: koffiNative.exists, sizeBytes: koffiNative.size };
  if (missing.length > 0) {
    artifactFailure(failures, fileName, "pluginClosure", { missing });
  }
  if (!koffiNative.exists || koffiNative.size === 0) {
    artifactFailure(failures, fileName, "koffiNative", koffiNative);
  }

  const manifest = await readJsonOrNull(join(pluginRoot, ".zcode-plugin", "plugin.json"));
  const hasStudioServer = Boolean(manifest?.mcpServers?.studio);
  const uiSurfacesCount = Array.isArray(manifest?.ui?.surfaces) ? manifest.ui.surfaces.length : 0;
  checks.packagedManifest = { mcpServersStudioPresent: hasStudioServer, uiSurfacesCount };
  if (!hasStudioServer) {
    artifactFailure(failures, fileName, "packagedManifest.mcpServersStudioPresent", "插件清单缺少 mcpServers.studio");
  }
  if (uiSurfacesCount === 0) {
    artifactFailure(failures, fileName, "packagedManifest.uiSurfacesCount", "插件清单 ui.surfaces 为空");
  }
  // 安装包内清单必须仍是源形态（command=node + ${ZCODE_PLUGIN_ROOT} 未展开）：
  // 运行时改写只发生在首次启动 seed 出的官方缓存副本里；构建期就把机器路径烤进包是缺陷。
  if (expectSourceForm) {
    const command = manifest?.mcpServers?.studio?.command ?? null;
    const args = Array.isArray(manifest?.mcpServers?.studio?.args) ? manifest.mcpServers.studio.args : [];
    const sourceForm =
      command === "node" &&
      args.length === 1 &&
      typeof args[0] === "string" &&
      args[0].includes("${ZCODE_PLUGIN_ROOT}");
    checks.packagedManifest.sourceFormRetained = sourceForm;
    if (!sourceForm) {
      artifactFailure(failures, fileName, "packagedManifest.sourceFormRetained", {
        message: "安装包内 plugin.json 应保持源形态（command=node、${ZCODE_PLUGIN_ROOT} 未展开）",
        command,
        args,
      });
    }
  }
  return manifest;
}

/** Linux desktop entry 断言（deb 的 usr/share/applications 与 AppImage 根的 *.desktop）。 */
async function inspectDesktopEntry(desktopFile, checks, failures, fileName) {
  const present = await pathExists(desktopFile);
  const content = present ? ((await readFileOrNull(desktopFile)) ?? "") : null;
  checks.desktopEntry = {
    file: desktopFile,
    present,
    nameMOS: content ? /^Name=MOS$/m.test(content) : false,
    execMentionsMos: content ? /(?:^|[/\\=])mos(?:\s|$|%)/m.test(content) : false,
    iconMos: content ? /^Icon=mos$/m.test(content) : false,
  };
  if (!present) {
    artifactFailure(failures, fileName, "desktopEntry", `缺少 Linux desktop entry：${desktopFile}`);
  }
}

async function inspectDebArtifact({ filePath, extractDir, platformKey, mosVersion }) {
  const checks = {};
  const failures = [];
  const fileName = basename(filePath);

  // dpkg-deb -I：包名/维护者/版本必须指向 MOS。
  const infoResult = await runCapture("dpkg-deb", ["-I", filePath], { timeoutMs: 120_000 });
  const info = infoResult.code === 0 ? parseDpkgInfo(infoResult.stdout) : {};
  checks.dpkgInfo = {
    toolAvailable: infoResult.code === 0,
    packageName: info.Package ?? null,
    version: info.Version ?? null,
    maintainer: info.Maintainer ?? null,
    architecture: info.Architecture ?? null,
    packageNameOk: info.Package === MOS_LINUX_PACKAGE_NAME,
    versionOk: info.Version === mosVersion,
    maintainerOk: /PaySwap/i.test(info.Maintainer ?? ""),
  };
  if (infoResult.code !== 0) {
    artifactFailure(failures, fileName, "dpkgInfo.toolAvailable", {
      message: "dpkg-deb -I 失败（构建机必须安装 dpkg-deb）",
      stderr: infoResult.stderr?.slice(-2000),
      error: infoResult.error,
    });
  } else {
    if (!checks.dpkgInfo.packageNameOk) {
      artifactFailure(failures, fileName, "dpkgInfo.packageNameOk", `deb 包名必须为 ${MOS_LINUX_PACKAGE_NAME}，实际 ${info.Package}`);
    }
    if (!checks.dpkgInfo.versionOk) {
      artifactFailure(failures, fileName, "dpkgInfo.versionOk", `deb 版本必须等于 MOS 版本 ${mosVersion}，实际 ${info.Version}`);
    }
    if (!checks.dpkgInfo.maintainerOk) {
      artifactFailure(failures, fileName, "dpkgInfo.maintainerOk", `deb 维护者必须包含 PaySwap，实际 ${info.Maintainer}`);
    }
  }

  // dpkg-deb -x 到临时目录做内容断言（无需安装）。
  const extractResult = await runCapture("dpkg-deb", ["-x", filePath, extractDir], { timeoutMs: 300_000 });
  checks.dpkgExtract = { ok: extractResult.code === 0 };
  if (extractResult.code !== 0) {
    artifactFailure(failures, fileName, "dpkgExtract", {
      message: "dpkg-deb -x 解包失败",
      stderr: extractResult.stderr?.slice(-2000),
    });
    return { checks, failures };
  }

  const resourcesDir = join(extractDir, resourcesDirRelativePath("deb"));
  const executablePath = join(extractDir, MOS_DEB_INSTALL_DIR, MOS_LINUX_EXECUTABLE_NAME);
  const appAsarPath = join(resourcesDir, "app.asar");
  checks.linuxExecutable = {
    path: executablePath,
    present: await pathExists(executablePath),
    executable: await executableFile(executablePath),
  };
  if (!checks.linuxExecutable.present) {
    artifactFailure(failures, fileName, "linuxExecutable", `deb 缺少可执行入口 ${MOS_DEB_INSTALL_DIR}/${MOS_LINUX_EXECUTABLE_NAME}`);
  }
  checks.appAsarPresent = await pathExists(appAsarPath);
  if (!checks.appAsarPresent) {
    artifactFailure(failures, fileName, "appAsarPresent", "deb 缺少 resources/app.asar");
  }

  await inspectStudioPluginRoot(join(resourcesDir, MOS_STUDIO_PLUGIN_RESOURCE_PATH), platformKey, checks, failures, fileName, {
    expectSourceForm: true,
  });
  await inspectDesktopEntry(join(extractDir, "usr", "share", "applications", `${MOS_LINUX_EXECUTABLE_NAME}.desktop`), checks, failures, fileName);
  return { checks, failures };
}

async function inspectAppImageArtifact({ filePath, extractDir, platformKey }) {
  const checks = {};
  const failures = [];
  const fileName = basename(filePath);

  // AppImage 无 root 也能解包：--appimage-extract 输出 squashfs-root 到当前工作目录。
  await chmod(filePath, 0o755);
  const extractResult = await runCapture(filePath, ["--appimage-extract"], {
    cwd: extractDir,
    timeoutMs: 300_000,
  });
  checks.appimageExtract = { ok: extractResult.code === 0 };
  if (extractResult.code !== 0) {
    artifactFailure(failures, fileName, "appimageExtract", {
      message: "AppImage --appimage-extract 失败",
      stderr: extractResult.stderr?.slice(-2000),
      stdout: extractResult.stdout?.slice(-2000),
    });
    return { checks, failures };
  }

  const root = join(extractDir, "squashfs-root");
  const resourcesDir = join(root, "resources");
  const executablePath = join(root, MOS_LINUX_EXECUTABLE_NAME);
  checks.linuxExecutable = {
    path: executablePath,
    present: await pathExists(executablePath),
    executable: await executableFile(executablePath),
  };
  if (!checks.linuxExecutable.present) {
    artifactFailure(failures, fileName, "linuxExecutable", `AppImage 缺少可执行入口 squashfs-root/${MOS_LINUX_EXECUTABLE_NAME}`);
  }
  checks.appAsarPresent = await pathExists(join(resourcesDir, "app.asar"));
  if (!checks.appAsarPresent) {
    artifactFailure(failures, fileName, "appAsarPresent", "AppImage 缺少 resources/app.asar");
  }
  await inspectStudioPluginRoot(join(resourcesDir, MOS_STUDIO_PLUGIN_RESOURCE_PATH), platformKey, checks, failures, fileName, {
    expectSourceForm: true,
  });
  await inspectDesktopEntry(join(root, `${MOS_LINUX_EXECUTABLE_NAME}.desktop`), checks, failures, fileName);
  return { checks, failures };
}

async function inspectMacZipArtifact({ filePath, extractDir, platformKey, mosVersion }) {
  const checks = {};
  const failures = [];
  const fileName = basename(filePath);

  const unzipResult = await runCapture("unzip", ["-q", filePath, "-d", extractDir], { timeoutMs: 600_000 });
  checks.unzip = { ok: unzipResult.code === 0 };
  if (unzipResult.code !== 0) {
    artifactFailure(failures, fileName, "unzip", {
      message: "unzip 解包失败（内容检查用 mac zip 产物）",
      stderr: unzipResult.stderr?.slice(-2000),
    });
    return { checks, failures };
  }

  const appRoot = join(extractDir, "MOS.app");
  const resourcesDir = join(appRoot, "Contents", "Resources");
  const binaryPath = join(appRoot, "Contents", "MacOS", "MOS");
  checks.macExecutable = {
    path: binaryPath,
    present: await pathExists(binaryPath),
    executable: await executableFile(binaryPath),
  };
  if (!checks.macExecutable.present) {
    artifactFailure(failures, fileName, "macExecutable", "zip 缺少 MOS.app/Contents/MacOS/MOS");
  }
  checks.appAsarPresent = await pathExists(join(resourcesDir, "app.asar"));
  if (!checks.appAsarPresent) {
    artifactFailure(failures, fileName, "appAsarPresent", "zip 缺少 MOS.app/Contents/Resources/app.asar");
  }

  // Info.plist 身份断言：优先 plutil -p，缺失时退回 XML 解析。
  const plistPath = join(appRoot, "Contents", "Info.plist");
  let plist = null;
  let plistMode = "xml";
  if (await commandExists("plutil")) {
    const plutilResult = await runCapture("plutil", ["-p", plistPath], { timeoutMs: 30_000 });
    if (plutilResult.code === 0) {
      plist = parseInfoPlist(plutilResult.stdout, { mode: "plutil" });
      plistMode = "plutil";
    }
  }
  if (!plist) {
    const plistText = await readFileOrNull(plistPath);
    plist = plistText ? parseInfoPlist(plistText) : null;
  }
  checks.infoPlist = {
    parsedVia: plistMode,
    CFBundleIdentifier: plist?.CFBundleIdentifier ?? null,
    CFBundleName: plist?.CFBundleName ?? null,
    CFBundleExecutable: plist?.CFBundleExecutable ?? null,
    CFBundleShortVersionString: plist?.CFBundleShortVersionString ?? null,
    bundleIdOk: plist?.CFBundleIdentifier === "org.payswap.mos",
    bundleNameOk: plist?.CFBundleName === "MOS",
    bundleExecutableOk: plist?.CFBundleExecutable === "MOS",
    versionOk: plist?.CFBundleShortVersionString === mosVersion,
  };
  for (const [check, ok, expected, actual] of [
    ["bundleIdOk", checks.infoPlist.bundleIdOk, "org.payswap.mos", checks.infoPlist.CFBundleIdentifier],
    ["bundleNameOk", checks.infoPlist.bundleNameOk, "MOS", checks.infoPlist.CFBundleName],
    ["bundleExecutableOk", checks.infoPlist.bundleExecutableOk, "MOS", checks.infoPlist.CFBundleExecutable],
    ["versionOk", checks.infoPlist.versionOk, mosVersion, checks.infoPlist.CFBundleShortVersionString],
  ]) {
    if (!ok) {
      artifactFailure(failures, fileName, `infoPlist.${check}`, `期望 ${expected}，实际 ${actual}`);
    }
  }

  await inspectStudioPluginRoot(join(resourcesDir, MOS_STUDIO_PLUGIN_RESOURCE_PATH), platformKey, checks, failures, fileName, {
    expectSourceForm: true,
  });
  return { checks, failures };
}

async function inspectWindowsExeArtifact({ filePath, extractDir, platformKey }) {
  const checks = {};
  const failures = [];
  const fileName = basename(filePath);

  // NSIS 安装包由 7z 列表/定向解出（GH runner 预装 7z；本地可能叫 7zz）。
  const sevenZip = await firstExistingBinary(["7z", "7zz"]);
  checks.sevenZip = { tool: sevenZip, available: Boolean(sevenZip) };
  if (!sevenZip) {
    artifactFailure(failures, fileName, "sevenZip.available", "构建机缺少 7z/7zz（NSIS 内容断言必需）");
    return { checks, failures };
  }

  const listResult = await runCapture(sevenZip, ["l", filePath], { timeoutMs: 300_000 });
  checks.sevenZipList = { ok: listResult.code === 0 };
  if (listResult.code !== 0) {
    artifactFailure(failures, fileName, "sevenZipList", {
      message: "7z l 失败",
      stderr: listResult.stderr?.slice(-2000),
    });
    return { checks, failures };
  }

  // 安装器必须携带：MOS.exe、resources\app.asar、插件闭包（$PLUGINSDIR 属安装器私有，不在断言内）。
  const pluginRootPrefix = `resources/${MOS_STUDIO_PLUGIN_RESOURCE_PATH}`;
  const requiredEntries = [
    "MOS.exe",
    "resources/app.asar",
    ...requiredStudioPluginFiles(platformKey).map((relative) => `${pluginRootPrefix}/${relative}`),
  ];
  const listing = sevenZipListingHasEntries(listResult.stdout, requiredEntries);
  checks.requiredEntries = { missing: listing.missing, listedCount: listing.listedCount };
  if (listing.missing.length > 0) {
    artifactFailure(failures, fileName, "requiredEntries", { missing: listing.missing });
  }

  // 定向解出插件闭包做深度断言（koffi.node 非空 + 清单内容）。
  const extractArgs = ["x", filePath, `-o${extractDir}`, "-y"];
  for (const relative of requiredStudioPluginFiles(platformKey)) {
    extractArgs.push(`${pluginRootPrefix}/${relative}`.replaceAll("/", "\\"));
  }
  const extractResult = await runCapture(sevenZip, extractArgs, { timeoutMs: 300_000 });
  checks.sevenZipExtract = { ok: extractResult.code === 0 };
  const pluginRoot = join(extractDir, ...pluginRootPrefix.split("/"));
  if (extractResult.code === 0) {
    await inspectStudioPluginRoot(pluginRoot, platformKey, checks, failures, fileName, {
      expectSourceForm: true,
    });
  } else {
    artifactFailure(failures, fileName, "sevenZipExtract", {
      message: "7z 定向解出插件闭包失败",
      stderr: extractResult.stderr?.slice(-2000),
    });
  }
  return { checks, failures };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const spec = getPlatformSpec(args.platform);
  const distDir = resolve(args.distDir);
  const failures = [];
  /** @type {Array<Record<string, unknown>>} */
  const artifacts = [];

  const expectedNames = expectedArtifactFileNames(args.platform, args.mosVersion);

  // 1) 产物存在 + 体积 + sha256。
  for (const name of expectedNames) {
    const filePath = join(distDir, name);
    const parsed = parseArtifactFileName(name);
    const checks = {};
    if (!(await pathExists(filePath))) {
      checks.filePresent = false;
      artifactFailure(failures, name, "filePresent", `缺少必需产物：${filePath}`);
      artifacts.push({ file: name, path: filePath, sizeBytes: null, sha256: null, checks, extension: parsed?.extension ?? null, inspected: false });
      continue;
    }
    const facts = await artifactFacts(filePath);
    checks.filePresent = true;
    checks.sizeAboveMinimum = facts.sizeBytes > MIN_ARTIFACT_BYTES;
    if (!checks.sizeAboveMinimum) {
      artifactFailure(failures, name, "sizeAboveMinimum", {
        message: `产物体积必须大于 ${MIN_ARTIFACT_BYTES} 字节`,
        sizeBytes: facts.sizeBytes,
      });
    }
    if (!parsed || !artifactExtensionMatchesPlatform(parsed.extension, args.platform)) {
      artifactFailure(failures, name, "artifactNameContract", `产物名不符合平台命名契约：${name}`);
    }

    // 2) 按格式做内容断言（mac 内容检查走 zip；dmg 只记录事实）。
    let inspected = false;
    if (parsed) {
      const extension = parsed.extension.toLowerCase();
      const extractDir = await mkdtemp(join(tmpdir(), `mos-inspect-${extension}-`));
      try {
        if (extension === "deb" && spec.os === "linux") {
          const result = await inspectDebArtifact({ filePath, extractDir, platformKey: args.platform, mosVersion: args.mosVersion });
          Object.assign(checks, result.checks);
          failures.push(...result.failures);
          inspected = true;
        } else if (extension === "appimage" && spec.os === "linux") {
          const result = await inspectAppImageArtifact({ filePath, extractDir, platformKey: args.platform });
          Object.assign(checks, result.checks);
          failures.push(...result.failures);
          inspected = true;
        } else if (extension === "zip" && spec.os === "darwin") {
          const result = await inspectMacZipArtifact({ filePath, extractDir, platformKey: args.platform, mosVersion: args.mosVersion });
          Object.assign(checks, result.checks);
          failures.push(...result.failures);
          inspected = true;
        } else if (extension === "dmg" && spec.os === "darwin") {
          checks.dmgContentInspection = "dmg 内容断言走同名 zip（sha256/size 已记录）";
        } else if (extension === "exe" && spec.os === "win32") {
          const result = await inspectWindowsExeArtifact({ filePath, extractDir, platformKey: args.platform });
          Object.assign(checks, result.checks);
          failures.push(...result.failures);
          inspected = true;
        } else {
          checks.contentInspection = `产物扩展名 ${parsed.extension} 与平台 ${args.platform} 不匹配，跳过内容断言`;
        }
      } finally {
        await rm(extractDir, { recursive: true, force: true });
      }
    }
    artifacts.push({
      file: facts.file,
      path: facts.path,
      sizeBytes: facts.sizeBytes,
      sha256: facts.sha256,
      extension: parsed?.extension ?? null,
      inspected,
      checks,
    });
  }

  // 3) 更新 feed 元数据扫描（MOS publish=null：feed manifest 严禁出现）。
  const updateMetadata = await scanUpdateMetadata(distDir);
  const updateMetadataChecks = {
    distDirReadable: updateMetadata.distDirReadable,
    updateFeedFiles: updateMetadata.updateFeedFiles,
    blockmapByproducts: updateMetadata.blockmapByproducts,
    // blockmap 是 electron-builder 对 dmg/nsis 的差分更新副产物（differentialPackage 默认开启，
    // 与 publish 配置无关）；MOS 无更新 feed 时它惰性无害，但绝不允许作为发布资产上传——
    // 发布资产清单（release-manifest.json/SHA256SUMS）不得包含 blockmap，这项由发布工作流负责排除。
    blockmapPolicy: "not-a-release-asset: must be excluded by the release asset-collection job",
  };
  if (updateMetadata.updateFeedFiles.length > 0) {
    failures.push({
      artifact: "(dist)",
      check: "updateFeedMetadata",
      detail: `MOS publish 为 null，产物目录不得出现更新 feed manifest：${updateMetadata.updateFeedFiles.join(", ")}`,
    });
  }

  const evidence = {
    schema: SCHEMA,
    platform: args.platform,
    mosVersion: args.mosVersion,
    generatedAt: new Date().toISOString(),
    distDir,
    expectedArtifacts: expectedNames,
    artifacts,
    updateMetadata: updateMetadataChecks,
    ok: failures.length === 0,
    failures,
  };

  const payload = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(payload);
  if (args.jsonOut) {
    await writeFile(resolve(args.jsonOut), payload, "utf8");
  }
  return failures.length === 0 ? 0 : 1;
}

// 直接运行入口（测试 import parseArgs/解析器时不重复执行 main）。
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`[inspect-package] 参数或内部错误：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
