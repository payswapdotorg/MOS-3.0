// MOS 平台目标模型：产物命名契约、平台绑定包名、安装目录解析、数据目录隔离模型。
// 事实源（不得凭记忆改）：
// - 产物名：packages/desktop/electron-builder.config.js buildDesktopArtifactName
//   —— `${productName}-${version}-${platformName}-${arch}${后缀}.${ext}`，MOS 的 productName=MOS；
// - Linux 布局：electron-builder deb 默认安装到 /opt/<productName>（config 无覆盖）→ /opt/MOS，
//   executableName=mos（linux.executableName），desktop 文件名取 executableName（mos.desktop）；
// - Windows 布局：nsis { oneClick:false, allowToChangeInstallationDirectory:true } 且无 perMachine
//   → 每用户安装，默认目录 %LOCALAPPDATA%\Programs\MOS；卸载注册表键
//   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<UUIDv5(appId, ns-uuid)>；
// - keyring 平台绑定包：packages/desktop/scripts/mos-plugin-bundle.mjs keyringPlatformPackageName；
// - koffi 原生路径：node_modules/koffi/build/koffi/<os>_<arch>/koffi.node；
// - 数据隔离：packages/desktop/src/main/desktopRuntimeEnv.ts —— MOS userData=<appData>/MOS，
//   agent/services 数据根=~/.mos/.zcode/...（上游 ZCode 为 <appData>/ZCode 与 ~/.zcode）。
import { createHash } from "node:crypto";
import { join, win32 } from "node:path";

export const MOS_PRODUCT_NAME = "MOS";
export const MOS_APP_ID = "org.payswap.mos";
export const MOS_LINUX_EXECUTABLE_NAME = "mos";
export const MOS_LINUX_PACKAGE_NAME = "mos";
export const MOS_DEB_INSTALL_DIR = "/opt/MOS";
export const MOS_PLUGIN_ID = "mos-studio@zcode-plugins-official";
export const MOS_PLUGIN_NAME = "mos-studio";
export const MOS_PLUGIN_VERSION = "0.1.0";
export const ZCODE_OFFICIAL_MARKETPLACE = "zcode-plugins-official";
export const MOS_STUDIO_STATUS_TOOL = "mos_studio_status";
export const MOS_STUDIO_SERVER_KEY = "studio";
export const UPSTREAM_ZCODE_APPDATA_DIR_NAME = "ZCode";
export const MOS_ELECTRON_APPDATA_DIR_NAME = "MOS";
export const MOS_DATA_BASE_DIR_NAME = ".mos";
export const MOS_USER_DATA_MARKER_FILE = "mos-release-smoke-marker.json";

/** electron-builder 的 deb/RPM 安装前缀（LinuxTargetHelper installPrefix，默认 /opt）。 */
export const LINUX_INSTALL_PREFIX = "/opt";

/** electron-builder NSIS 卸载键命名空间常量（app-builder-lib/targets/nsis/NsisTarget.ts）。 */
export const ELECTRON_BUILDER_NS_UUID = "50e065bc-3134-11e6-9bab-38c9862bdaf3";

/**
 * 平台规格表。requiredArtifacts 为命名契约要求必须存在的产物扩展名
 * （spec/backlog/release-engineering.md §3 的下载矩阵）。
 */
export const PLATFORM_SPECS = Object.freeze({
  "linux-x64": {
    key: "linux-x64",
    os: "linux",
    arch: "x64",
    platformName: "linux",
    keyringPlatformPackage: "@napi-rs/keyring-linux-x64-gnu",
    koffiPlatformKey: "linux_x64",
    requiredArtifacts: ["AppImage", "deb"],
  },
  "linux-arm64": {
    key: "linux-arm64",
    os: "linux",
    arch: "arm64",
    platformName: "linux",
    keyringPlatformPackage: "@napi-rs/keyring-linux-arm64-gnu",
    koffiPlatformKey: "linux_arm64",
    requiredArtifacts: ["AppImage", "deb"],
  },
  "mac-x64": {
    key: "mac-x64",
    os: "darwin",
    arch: "x64",
    platformName: "mac",
    keyringPlatformPackage: "@napi-rs/keyring-darwin-x64",
    koffiPlatformKey: "darwin_x64",
    requiredArtifacts: ["dmg", "zip"],
  },
  "mac-arm64": {
    key: "mac-arm64",
    os: "darwin",
    arch: "arm64",
    platformName: "mac",
    keyringPlatformPackage: "@napi-rs/keyring-darwin-arm64",
    koffiPlatformKey: "darwin_arm64",
    requiredArtifacts: ["dmg", "zip"],
  },
  "win-x64": {
    key: "win-x64",
    os: "win32",
    arch: "x64",
    platformName: "win",
    keyringPlatformPackage: "@napi-rs/keyring-win32-x64-msvc",
    koffiPlatformKey: "win32_x64",
    requiredArtifacts: ["exe"],
  },
  "win-arm64": {
    key: "win-arm64",
    os: "win32",
    arch: "arm64",
    platformName: "win",
    keyringPlatformPackage: "@napi-rs/keyring-win32-arm64-msvc",
    koffiPlatformKey: "win32_arm64",
    requiredArtifacts: ["exe"],
  },
});

export function getPlatformSpec(platformKey) {
  const spec = PLATFORM_SPECS[platformKey];
  if (!spec) {
    throw new Error(
      `未知平台目标：${platformKey}（支持：${Object.keys(PLATFORM_SPECS).join(", ")}）`,
    );
  }
  return spec;
}

/**
 * 单个产物文件名（与 electron-builder artifactName 模板一致）。
 * backendSuffix 仅测试后端产物使用（_TEST）；正式 MOS 发布产物为空。
 */
export function artifactFileName({ version, platformName, arch, extension, product = MOS_PRODUCT_NAME, backendSuffix = "" }) {
  return `${product}-${version}-${platformName}-${arch}${backendSuffix}.${extension}`;
}

/** 平台的期望产物文件名列表（必需产物，非可选）。 */
export function expectedArtifactFileNames(platformKey, version, { backendSuffix = "" } = {}) {
  const spec = getPlatformSpec(platformKey);
  return spec.requiredArtifacts.map((extension) =>
    artifactFileName({
      version,
      platformName: spec.platformName,
      arch: spec.arch,
      extension,
      backendSuffix,
    }),
  );
}

const ARTIFACT_NAME_PATTERN = new RegExp(
  `^(?<product>${MOS_PRODUCT_NAME})-(?<version>[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?)-(?<platform>linux|win|mac)-(?<arch>x64|arm64)(?<suffix>_TEST)?\\.(?<ext>[A-Za-z0-9.]+)$`,
);

/**
 * 严格解析产物文件名。返回 null 表示不符合命名契约（不得作为 MOS 产物被引用）。
 */
export function parseArtifactFileName(fileName) {
  const match = ARTIFACT_NAME_PATTERN.exec(fileName);
  if (!match?.groups) return null;
  return {
    product: match.groups.product,
    version: match.groups.version,
    platform: match.groups.platform,
    arch: match.groups.arch,
    backendSuffix: match.groups.suffix ?? "",
    extension: match.groups.ext,
  };
}

/**
 * 产物扩展名与平台是否匹配（AppImage/deb/pkg.tar.zst 只属于 linux，dmg/zip 只属于 mac，exe 只属于 win）。
 */
export function artifactExtensionMatchesPlatform(extension, platformKey) {
  const spec = getPlatformSpec(platformKey);
  const linuxExtensions = ["appimage", "deb", "rpm", "pkg.tar.zst"];
  const macExtensions = ["dmg", "zip"];
  const winExtensions = ["exe"];
  const normalized = extension.toLowerCase();
  if (spec.os === "linux") return linuxExtensions.includes(normalized);
  if (spec.os === "darwin") return macExtensions.includes(normalized);
  return winExtensions.includes(normalized);
}

/** @napi-rs/keyring 平台绑定包目录名（@napi-rs/<dir>，与 mos-plugin-bundle.mjs 的表一致）。 */
export function keyringPlatformPackageName(os, arch) {
  const spec = Object.values(PLATFORM_SPECS).find(
    (candidate) => candidate.os === os && candidate.arch === arch,
  );
  if (!spec) {
    throw new Error(`不支持的 keyring 平台目标：${os}_${arch}`);
  }
  return spec.keyringPlatformPackage;
}

/** 安装包内 MOS Studio 插件根（相对 resources 目录）。 */
export const MOS_STUDIO_PLUGIN_RESOURCE_PATH = "glm/packages/mos-studio-plugin";

/** 插件根内必需产物（与 mos-plugin-bundle.mjs MOS_STUDIO_REQUIRED_PLUGIN_FILES + 原生闭包一致）。 */
export function requiredStudioPluginFiles(platformKey) {
  const spec = getPlatformSpec(platformKey);
  const keyringBindingDir = spec.keyringPlatformPackage.split("/")[1];
  return [
    ".zcode-plugin/plugin.json",
    "hooks/hooks.json",
    "dist/server.mjs",
    "dist/hook.mjs",
    "dist/ui/panel.html",
    "node_modules/@napi-rs/keyring/package.json",
    `node_modules/@napi-rs/${keyringBindingDir}/package.json`,
    "node_modules/koffi/index.js",
    `node_modules/koffi/build/koffi/${spec.koffiPlatformKey}/koffi.node`,
  ];
}

/** 各产物容器内 resources 目录的相对位置（解包后）。 */
export function resourcesDirRelativePath(extension) {
  switch (extension.toLowerCase()) {
    case "deb":
      return "opt/MOS/resources";
    case "appimage":
      return "squashfs-root/resources";
    case "zip":
      return "MOS.app/Contents/Resources";
    default:
      throw new Error(`该产物格式没有解包 resources 布局定义：${extension}`);
  }
}

/** Electron appData 目录（按平台；隔离 HOME 下解析）。 */
export function electronAppDataDir(platformKey, homeDir) {
  const spec = getPlatformSpec(platformKey);
  if (spec.os === "win32") return join(homeDir, "AppData", "Roaming");
  if (spec.os === "darwin") return join(homeDir, "Library", "Application Support");
  return join(homeDir, ".config");
}

/** MOS Electron userData 目录（<appData>/MOS）。 */
export function electronUserDataDir(platformKey, homeDir) {
  return join(electronAppDataDir(platformKey, homeDir), MOS_ELECTRON_APPDATA_DIR_NAME);
}

/** 上游 ZCode 的 Electron userData 目录（<appData>/ZCode，MOS 不得触碰）。 */
export function upstreamZCodeAppDataDir(platformKey, homeDir) {
  return join(electronAppDataDir(platformKey, homeDir), UPSTREAM_ZCODE_APPDATA_DIR_NAME);
}

/** MOS agent/services 数据基座（~/.mos）。 */
export function mosDataBaseDir(homeDir) {
  return join(homeDir, MOS_DATA_BASE_DIR_NAME);
}

/** 上游 ZCode agent 数据目录（~/.zcode，MOS 不得触碰）。 */
export function upstreamZCodeDataDir(homeDir) {
  return join(homeDir, ".zcode");
}

/**
 * 首次启动 seed 出的官方插件缓存根。
 * 实测形态（zcode plugins list 驱动 resolveOfficialPluginRoots → prepare）：
 * `<ZCODE_STORAGE_DIR>/cli/plugins/cache/zcode-plugins-official/mos-studio/<version>`
 * —— services 的 resolvePluginStorageRoot 在 storageRoot 下先落 plugins 段。
 */
export function seededPluginRoot(homeDir, pluginVersion = MOS_PLUGIN_VERSION) {
  return join(
    mosDataBaseDir(homeDir),
    ".zcode",
    "cli",
    "plugins",
    "cache",
    ZCODE_OFFICIAL_MARKETPLACE,
    MOS_PLUGIN_NAME,
    pluginVersion,
  );
}

/**
 * 冒烟驱动的 agent 类子进程（seed / MCP / hook）必须镜像桌面 buildHostProcessEnv 的
 * MOS 子进程环境契约（desktopRuntimeEnv）：ZCODE_HOME/ZCODE_DATA_BASE_DIR/…
 * 全部指向 MOS 数据根。run 5 实测：缺 ZCODE_HOME 时 CLI telemetry bootstrap
 * 回落到 `homedir()/.zcode/v2/telemetry-state.json`（decoy 被写）。
 */
export function buildAgentProcessEnv(platformKey, homeDir) {
  getPlatformSpec(platformKey);
  const mosDataRoot = join(mosDataBaseDir(homeDir), ".zcode");
  return {
    ZCODE_HOME: mosDataRoot,
    ZCODE_DATA_BASE_DIR: mosDataBaseDir(homeDir),
    ZCODE_STORAGE_DIR: mosDataRoot,
    ZCODE_SESSION_DB_PATH: join(mosDataRoot, "cli", "db", "db.sqlite"),
    ZCODE_LOG_DIR: join(mosDataRoot, "cli", "log"),
  };
}

/**
 * Electron userData 的期望家目录：macOS 上 Chromium 解析 appData 走操作系统真实家目录
 * （不跟随 HOME 环境覆盖，run 5 实测：首启 userData 始终落在真实家目录的
 * `~/Library/Application Support`），因此 darwin 的期望落点必须用真实家目录；
 * win/linux 的 Electron 跟随 APPDATA/XDG_CONFIG_HOME/HOME 环境变量，期望落点用隔离家目录。
 */
export function expectedElectronUserDataHome(platformKey, isolatedHomeDir, realHomeDir) {
  return getPlatformSpec(platformKey).os === "darwin" ? realHomeDir : isolatedHomeDir;
}

/** Windows 默认每用户安装目录（%LOCALAPPDATA%\Programs\MOS）。 */
export function defaultWindowsInstallDir(localAppDataDir) {
  return join(localAppDataDir, "Programs", MOS_PRODUCT_NAME);
}

/** NSIS 卸载注册表键（相对注册表根；每用户安装在 HKCU 下；分隔符恒为反斜杠）。 */
export function nsisUninstallRegistryKey(appId = MOS_APP_ID) {
  return win32.join(
    "Software",
    "Microsoft",
    "Windows",
    "CurrentVersion",
    "Uninstall",
    uuidV5(appId, ELECTRON_BUILDER_NS_UUID),
  );
}

/** RFC 4122 v5（SHA-1）。与 builder-util-runtime UUID.v5（electron-builder 的卸载键推导）逐位一致。 */
export function uuidV5(name, namespaceUuid) {
  const namespaceHex = namespaceUuid.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(namespaceHex)) {
    throw new Error(`非法 UUID 命名空间：${namespaceUuid}`);
  }
  const hash = createHash("sha1");
  hash.update(Buffer.from(namespaceHex, "hex"));
  hash.update(Buffer.from(String(name), "utf8"));
  const digest = hash.digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** 隔离运行环境（isolate-home 步骤产物）：HOME/USERPROFILE/APPDATA/XDG_* 全部指向隔离家目录。 */
export function buildIsolatedEnv(platformKey, homeDir, baseEnv = process.env) {
  const spec = getPlatformSpec(platformKey);
  const env = { ...baseEnv };
  // TMPDIR 保持系统值：xvfb-run / appimagetool / dpkg 等系统工具按系统临时目录工作。
  if (spec.os === "win32") {
    env.HOME = homeDir;
    env.USERPROFILE = homeDir;
    env.APPDATA = join(homeDir, "AppData", "Roaming");
    env.LOCALAPPDATA = join(homeDir, "AppData", "Local");
  } else {
    env.HOME = homeDir;
    delete env.USERPROFILE;
    if (spec.os === "linux") {
      env.XDG_CONFIG_HOME = join(homeDir, ".config");
      env.XDG_CACHE_HOME = join(homeDir, ".cache");
      env.XDG_DATA_HOME = join(homeDir, ".local", "share");
    }
  }
  return env;
}
