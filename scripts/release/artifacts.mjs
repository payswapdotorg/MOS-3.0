/**
 * MOS 安装包命名契约、目标矩阵与平台映射。
 *
 * 文件名契约来自 packages/desktop/electron-builder.config.js 的 buildDesktopArtifactName：
 *   `MOS-<version>-<mac|win|linux>-<arch><suffix?>.<ext>`
 * - 生产后端（ZCODE_ENV=production）无后缀；测试后端会出现 `_TEST` 后缀，发布链路不进入。
 * - 必选/尽力而为产物矩阵来自 spec/backlog/release-engineering.md §3：
 *   mac → dmg+zip 必选；win → exe 必选；linux → AppImage+deb 必选，rpm/pkg.tar.zst 为
 *   best-effort（runner 缺 fpm/rpmbuild 依赖时显式记录省略，不得静默或造占位文件）。
 */

export const MOS_ARTIFACT_FILENAME_PATTERN =
  /^MOS-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(mac|win|linux)-(x64|arm64)(_TEST)?\.([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)$/;

/** 初始发布矩阵（原生 runner）：其余目标显式省略，见 describeOmittedTargets。 */
export const MOS_PLATFORMS = Object.freeze({
  "linux-x64": Object.freeze({ os: "linux", arch: "x64" }),
  "mac-arm64": Object.freeze({ os: "mac", arch: "arm64" }),
  "mac-x64": Object.freeze({ os: "mac", arch: "x64" }),
  "win-x64": Object.freeze({ os: "win", arch: "x64" }),
});

export const REQUIRED_FORMATS_BY_PLATFORM = Object.freeze({
  "mac-arm64": Object.freeze(["dmg", "zip"]),
  "mac-x64": Object.freeze(["dmg", "zip"]),
  "win-x64": Object.freeze(["exe"]),
  "linux-x64": Object.freeze(["AppImage", "deb"]),
});

// best-effort：允许缺失；缺失时进 release manifest 的 limitations，不失败。
export const OPTIONAL_FORMATS_BY_PLATFORM = Object.freeze({
  "linux-x64": Object.freeze(["rpm", "pkg.tar.zst"]),
});

/** 消费端（本地 agent / 冒烟）优先选择的主安装包格式。 */
export const PRIMARY_FORMAT_BY_OS = Object.freeze({
  mac: "dmg",
  win: "exe",
  linux: "AppImage",
});

/**
 * 各 OS 最低系统要求（来源 electron-builder.config.js / 构建基线）：
 * - mac: electron-builder mac.minimumSystemVersion = "13.0.0"；
 * - win: NSIS 目标未显式设置，沿 electron-builder 默认（Windows 10 起）；
 * - linux: 整包 glibc 下限由 node-pty prebuild 与 bfs/ugrep 抬到 2.28（RHEL 8 基线）。
 */
export const MIN_OS_BY_OS = Object.freeze({
  mac: "13.0.0",
  win: "Windows 10 (electron-builder NSIS default)",
  linux: "glibc >= 2.28 (RHEL 8 baseline)",
});

/** MOS publish 必须为 null：产物目录出现这些文件说明更新 feed 配置回流，收集阶段直接失败。 */
export const FORBIDDEN_ARTIFACT_PATTERNS = [
  { pattern: /^latest.*\.ya?ml$/iu, label: "latest*.yml（electron-builder 更新清单）" },
  // inert: true —— blockmap 在 electron-builder 26 的 mac 目标上无条件生成（无
  // differentialPackage 开关），没有 latest*.yml 时不构成 feed 元数据；不收集不上传，
  // 仅记录。Windows 侧由 nsis.differentialPackage=false 从源头关闭。
  { pattern: /\.blockmap$/iu, label: "*.blockmap（差分更新块文件）", inert: true },
];

/** 未发布目标的显式声明（backlog §3 "Publish only after native/runtime smoke verification"）。 */
export function describeOmittedTargets() {
  return [
    { target: "win-arm64", reason: "pending native/runtime smoke verification" },
    { target: "linux-arm64", reason: "pending native/runtime smoke verification" },
  ];
}

/** 格式统一按小写比较（AppImage/appimage 同一格式）。 */
export function formatKey(extension) {
  return String(extension).toLowerCase();
}

/**
 * 解析 MOS 安装包文件名。非 MOS 命名返回 null（调用方自行决定忽略或报错）。
 * 返回 { product, version, os, arch, suffix, format, filename }。
 */
export function parseMosArtifactFilename(filename) {
  const match = MOS_ARTIFACT_FILENAME_PATTERN.exec(filename ?? "");
  if (!match) return null;
  return {
    product: "MOS",
    version: match[1],
    os: match[2],
    arch: match[3],
    suffix: match[4] ?? "",
    format: match[5],
    filename,
  };
}

/** 发布产物必须来自生产后端：`_TEST` 后缀的包不允许进入发布产物集。 */
export function isProductionMosArtifact(parsed) {
  return parsed !== null && parsed.product === "MOS" && parsed.suffix === "";
}

/**
 * 宿主平台 → MOS os/arch 映射（select-installer 的 --detect 与冒烟选择共用）。
 * process.platform: darwin→mac、win32→win、linux→linux；arch 仅支持 x64/arm64。
 */
export function detectHostOsArch(platform = process.platform, arch = process.arch) {
  const os = { darwin: "mac", win32: "win", linux: "linux" }[platform];
  if (!os) throw new Error(`不支持的宿主平台：${platform}（期望 darwin/win32/linux）`);
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`不支持的宿主架构：${arch}（期望 x64/arm64）`);
  }
  return { os, arch };
}

/** 基于命名约定推导 target（platform 键）。未登记的 os/arch 组合抛错。 */
export function platformKeyForOsArch(os, arch) {
  for (const [key, value] of Object.entries(MOS_PLATFORMS)) {
    if (value.os === os && value.arch === arch) return key;
  }
  throw new Error(`未登记的发布目标：${os}-${arch}（见 scripts/release/artifacts.mjs 矩阵）`);
}
