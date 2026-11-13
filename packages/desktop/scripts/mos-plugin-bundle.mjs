#!/usr/bin/env node
// MOS Studio 插件随包 staging：把 packages/mos-studio 的构建产物与原生依赖闭包组装成
// “内置官方插件”布局（glm/packages/mos-studio-plugin），供 bootstrap 的 filesystem seed
// 在安装包内发现（official-plugin-definitions.ts 的 rootCandidates）。
//
// 关键约束（spec/backlog/release-engineering.md §2）：
// - 安装后的 MOS 不得依赖仓库 checkout、workspace symlink、开发 node_modules、plugins.dirs
//   手工配置 —— 因此 @napi-rs/keyring（凭据存储栈）与 koffi（CUA FFI）按目标平台闭包
//   vendor 进插件目录（runtimeTopLevelPaths: ["node_modules"]），与 computer-use 插件
//   staging sharp 的既有模式一致；
// - 缺任何必需产物/原生模块直接失败，绝不产出残缺插件（与 prepare-agent-node-bundle 的
//   requiredRuntimePaths 校验同一语义）；
// - dist 三件套由 packages/mos-studio scripts/build.mjs 产出，调用方必须先完成
//   `pnpm --filter @mos/studio build`（本脚本只做 staging 与校验，不重复构建）。
//
// 用法：node scripts/mos-plugin-bundle.mjs [--platform <os>-<arch>] [--out <dir>]
//   平台键与 target-platform.mjs 的 getTargetPlatform().key 一致（win32-x64 / darwin-arm64 /
//   linux-x64，连字符形式）—— glm staging 目录必须与 stage-agent-bundle.mjs 同键
//   （electron-builder 按 bundled-agents/<key>/glm 整目录入包）；koffi 的内部原生目录
//   仍按 koffi 自身约定使用 <os>_<arch> 下划线形式。默认平台 = 目标环境变量/宿主派生。
//   默认输出 = bundled-agents/<key>/glm/packages/mos-studio-plugin。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");

/** 插件必需产物（相对插件根）；缺一即失败。 */
export const MOS_STUDIO_REQUIRED_PLUGIN_FILES = [
  ".zcode-plugin/plugin.json",
  "hooks/hooks.json",
  "dist/server.mjs",
  "dist/hook.mjs",
  "dist/ui/panel.html",
];

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { platform: null, out: null, mosStudioRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--platform") parsed.platform = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
    else if (argv[i] === "--mos-studio-root") parsed.mosStudioRoot = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return parsed;
}

function hostPlatformKey() {
  // 与 stage-agent-bundle.mjs 同源：glm 目录键 = getTargetPlatform().key（连字符形式）。
  // 发布构建在 prepare:runtime-assets 链路里继承 ZCODE_TARGET_OS/ZCODE_TARGET_ARCH。
  return getTargetPlatform().key;
}

function parseStagingPlatformKey(platformKey) {
  const [os, arch] = String(platformKey).split("-");
  if (!os || !arch) {
    throw new Error(`[mos-plugin-bundle] 无效平台键：${platformKey}（应为 <os>-<arch>，如 linux-x64）`);
  }
  return { os, arch };
}

/** 在 pnpm 虚拟 store / hoisted 根中按包名解析真实包目录（koffi-package-assets 同模式）。 */
function resolveWorkspacePackage(packageName, fromDir) {
  const candidates = [resolve(fromDir, "node_modules", packageName)];
  const virtualStore = resolve(fromDir, "..", "..", "..", "..", "node_modules", ".pnpm");
  if (existsSync(virtualStore)) {
    // pnpm 10 目录形如 <name>@<version>/node_modules/<name>；前缀按 name@ 匹配防误命中。
    const prefix = `${packageName}@`;
    for (const entry of readdirSync(virtualStore)) {
      if (entry.startsWith(prefix)) {
        candidates.push(resolve(virtualStore, entry, "node_modules", packageName));
      }
    }
  }
  const hoisted = resolve(workspaceRoot, "node_modules", packageName);
  candidates.push(hoisted);
  for (const candidate of candidates) {
    const packageJson = join(candidate, "package.json");
    if (!existsSync(packageJson)) continue;
    try {
      if (JSON.parse(readFileSync(packageJson, "utf8")).name === packageName) return candidate;
    } catch {
      // 忽略无效 package.json，继续下一个候选。
    }
  }
  throw new Error(`[mos-plugin-bundle] cannot resolve ${packageName} from ${fromDir}`);
}

/** @napi-rs/keyring 平台绑定包名（napi-rs 三元组，与 keyring optionalDependencies 对齐）。 */
export function keyringPlatformPackageName(os, arch) {
  const table = {
    darwin: { arm64: "@napi-rs/keyring-darwin-arm64", x64: "@napi-rs/keyring-darwin-x64" },
    linux: {
      arm64: "@napi-rs/keyring-linux-arm64-gnu",
      x64: "@napi-rs/keyring-linux-x64-gnu",
    },
    win32: {
      arm64: "@napi-rs/keyring-win32-arm64-msvc",
      x64: "@napi-rs/keyring-win32-x64-msvc",
    },
  };
  const entry = table[os]?.[arch];
  if (!entry) {
    throw new Error(`[mos-plugin-bundle] unsupported keyring target: ${os}_${arch}`);
  }
  return entry;
}

function copyPackageInto(packageName, sourceRoot, targetRoot) {
  mkdirSync(dirname(targetRoot), { recursive: true });
  cpSync(sourceRoot, targetRoot, { recursive: true });
}

function verifyFiles(root, files) {
  const missing = files.filter((file) => !existsSync(resolve(root, file)));
  if (missing.length > 0) {
    throw new Error(
      `[mos-plugin-bundle] staged MOS Studio plugin is missing required files: ${missing.join(", ")}`,
    );
  }
}

/**
 * staging 主流程。返回 { stagedRoot, platform, written }；任何必需项缺失抛错。
 */
export function stageMosStudioPlugin(options = {}) {
  const platformKey = options.platform ?? hostPlatformKey();
  const { os, arch } = parseStagingPlatformKey(platformKey);
  const koffiArchKey = `${os}_${arch}`;
  const mosStudioRoot = resolve(options.mosStudioRoot ?? join(workspaceRoot, "packages", "mos-studio"));
  const stagedRoot = resolve(
    options.out ?? join(desktopRoot, "bundled-agents", platformKey, "glm", "packages", "mos-studio-plugin"),
  );

  // 1) 必需产物前置校验（staging 前失败比安装后 seed 失败更早、更便宜）。
  const missingSource = MOS_STUDIO_REQUIRED_PLUGIN_FILES.filter(
    (file) => !existsSync(join(mosStudioRoot, file)),
  );
  if (missingSource.length > 0) {
    throw new Error(
      `[mos-plugin-bundle] mos-studio build outputs missing (run \`pnpm --filter @mos/studio build\` first): ${missingSource.join(", ")}`,
    );
  }

  // 2) 清空旧 staging，复制插件主体（manifest、hooks、dist、README）。
  rmSync(stagedRoot, { recursive: true, force: true });
  mkdirSync(stagedRoot, { recursive: true });
  for (const relative of MOS_STUDIO_REQUIRED_PLUGIN_FILES) {
    const target = resolve(stagedRoot, relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(mosStudioRoot, relative), target);
  }
  for (const extra of ["README.md", "package.json"]) {
    const source = join(mosStudioRoot, extra);
    if (existsSync(source)) {
      cpSync(source, resolve(stagedRoot, extra));
    }
  }

  // 3) 原生依赖闭包 vendor（目标平台一份，写入插件 node_modules）：
  //    dist/server.mjs 的 createRequire 从插件根逐级向上解析 —— node_modules 放在
  //    插件根下，安装后的 seed（runtimeTopLevelPaths）会原样携带进官方插件缓存。
  const nodeModulesRoot = join(stagedRoot, "node_modules");
  // 3a) @napi-rs/keyring JS 包（原生二进制全部在平台绑定包里，此包本身很小，整包复制）。
  const keyringRoot = resolveWorkspacePackage("@napi-rs/keyring", mosStudioRoot);
  copyPackageInto("@napi-rs/keyring", keyringRoot, join(nodeModulesRoot, "@napi-rs", "keyring"));
  // 3b) @napi-rs/keyring 平台绑定包（单文件 .node + package.json）。
  const keyringPlatformName = keyringPlatformPackageName(os, arch);
  const keyringPlatformRoot = resolveWorkspacePackage(keyringPlatformName, mosStudioRoot);
  copyPackageInto(
    keyringPlatformName,
    keyringPlatformRoot,
    join(nodeModulesRoot, "@napi-rs", keyringPlatformName.split("/")[1]),
  );
  // 3c) koffi：JS 入口 + package.json + 仅目标平台二进制（与 koffi-package-assets 的
  //     glm staging 完全同一份最小闭包；koffi 内部目录用下划线 <os>_<arch> 约定）。
  const koffiRoot = resolveWorkspacePackage("koffi", mosStudioRoot);
  const koffiNativeDir = join("build", "koffi", koffiArchKey);
  const koffiNativeSource = join(koffiRoot, koffiNativeDir, "koffi.node");
  if (!existsSync(koffiNativeSource)) {
    throw new Error(
      `[mos-plugin-bundle] missing koffi native addon for ${platformKey}: ${koffiNativeSource}`,
    );
  }
  const stagedKoffiRoot = join(nodeModulesRoot, "koffi");
  mkdirSync(stagedKoffiRoot, { recursive: true });
  for (const file of ["index.js", "index.d.ts", "package.json"]) {
    if (existsSync(join(koffiRoot, file))) {
      cpSync(join(koffiRoot, file), join(stagedKoffiRoot, file));
    }
  }
  mkdirSync(join(stagedKoffiRoot, koffiNativeDir), { recursive: true });
  cpSync(koffiNativeSource, join(stagedKoffiRoot, koffiNativeDir, "koffi.node"));

  // 4) 终校验：staged 布局完整 + 原生模块存在且非空。
  verifyFiles(
    stagedRoot,
    [
      ...MOS_STUDIO_REQUIRED_PLUGIN_FILES,
      "node_modules/@napi-rs/keyring/package.json",
      `node_modules/@napi-rs/${keyringPlatformName.split("/")[1]}/package.json`,
      "node_modules/koffi/index.js",
      join("node_modules", "koffi", koffiNativeDir, "koffi.node").replaceAll("\\", "/"),
    ],
  );
  const nativeKoffi = statSync(join(stagedRoot, "node_modules", "koffi", koffiNativeDir, "koffi.node"));
  const keyringNative = readdirSync(
    join(nodeModulesRoot, "@napi-rs", keyringPlatformName.split("/")[1]),
  ).find((entry) => entry.endsWith(".node"));
  if (!keyringNative) {
    throw new Error(`[mos-plugin-bundle] keyring platform package has no .node binding for ${platformKey}`);
  }
  if (nativeKoffi.size === 0) {
    throw new Error(`[mos-plugin-bundle] koffi.node for ${koffiArchKey} is empty`);
  }

  return { stagedRoot, platform: platformKey };
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const args = parseArgs();
  const { stagedRoot, platform } = stageMosStudioPlugin(args);
  process.stdout.write(`[mos-plugin-bundle] staged mos-studio-plugin for ${platform} at ${stagedRoot}\n`);
}
