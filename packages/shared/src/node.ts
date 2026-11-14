/**
 * Node-only shared utilities.
 *
 * This subpath must not be imported by renderer/browser bundles.
 */
import { homedir, userInfo } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** 测试/企业环境覆盖 Muse Code 后端设置文件路径的环境变量（Host 服务与 CLI 端口共用同名约定）。 */
export const MUSE_CODE_SETTINGS_FILE_ENV = "ZCODE_MUSE_CODE_SETTINGS_FILE";

/** 与 personal provider_config.json 同目录（<homedir>/.zcode/v2/；Issue #24 / ACR-0002）。 */
export function defaultMuseCodeSettingsFilePath(home: string = homedir()): string {
  return join(home, ".zcode", "v2", "muse-code-backend.json");
}

export function resolveMuseCodeSettingsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MUSE_CODE_SETTINGS_FILE_ENV]?.trim();
  return override && override.length > 0 ? override : defaultMuseCodeSettingsFilePath();
}

/**
 * Muse 会话映射文件（MOS sessionId → muse sessionId；PR #27 评审 R2）：
 * 与 settings 同目录；env 覆盖约定供测试注入。文件由 bootstrap 端口读写
 * （原子写、宽容读），跨 MOS 重启保持会话连续性。
 */
export const MUSE_CODE_SESSIONS_FILE_ENV = "ZCODE_MUSE_CODE_SESSIONS_FILE";

export function defaultMuseCodeSessionsFilePath(home: string = homedir()): string {
  return join(home, ".zcode", "v2", "muse-code-sessions.json");
}

export function resolveMuseCodeSessionsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MUSE_CODE_SESSIONS_FILE_ENV]?.trim();
  return override && override.length > 0 ? override : defaultMuseCodeSessionsFilePath();
}

/**
 * Muse 子进程环境允许清单（PR #27 评审 R5）：delegated agent 的进程树只继承
 * 进程启动与 Muse 自身运行所需的变量 + MUSE_ 前缀透传（muse 官方 env 约定）。
 * Host 的其它集成凭据（GITHUB_TOKEN / OPENROUTER_API_KEY / *_SECRET 等）绝不进入。
 * 登录态保持：muse CLI 的凭据存于其自身配置目录（USERPROFILE/APPDATA/HOME 覆盖），
 * 不需要 MOS 传递任何凭据材料（ACR-0002 凭据红线）。
 */
export const MUSE_CHILD_ENV_ALLOWLIST: readonly string[] = [
  // 进程启动/查找可执行
  "PATH",
  "PATHEXT",
  // Windows 进程基础（缺失会导致 spawn/网络栈异常）
  "SystemRoot",
  "SystemDrive",
  "ComSpec",
  // 临时目录（--prompt-file 临时文件由 MOS 父进程创建，子进程也可能使用）
  "TEMP",
  "TMP",
  // 用户配置目录（muse CLI 登录态/配置的存放位置——保持既有订阅登录的关键）
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  // 区域/显示（CLI 输出编码稳定性）
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "NO_COLOR",
];

/**
 * 构造 Muse 子进程环境：仅复制允许清单内且值非空的变量，外加所有 `MUSE_` 前缀
 * 变量（官方 env 约定 + 测试 fixture 注入）。其余 Host 环境变量一律不继承。
 */
export function buildMuseChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of MUSE_CHILD_ENV_ALLOWLIST) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("MUSE_") && typeof value === "string" && value.length > 0) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}

/**
 * Windows PATH 解析：只返回可直接 spawn 的可执行文件（.exe/.com）。
 * .cmd/.bat npm shim 需要经 cmd.exe 解析，MOS 不为其打开 shell（Issue #24 / ACR-0002；
 * Host 探测与 CLI 执行端口共用同一判定，找不到返回 null）。
 */
export function resolveWindowsExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (command.includes("/") || command.includes("\\")) return null;
  const pathDirs = (env.PATH ?? "").split(";").filter((dir) => dir.length > 0);
  for (const dir of pathDirs) {
    for (const candidate of [`${command}.exe`, `${command}.com`]) {
      const fullPath = dir.endsWith("\\") ? `${dir}${candidate}` : `${dir}\\${candidate}`;
      try {
        if (existsSync(fullPath)) return fullPath;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Server 展示系统用户；容器的数字 UID 无需在 passwd 中有名称条目。 */
export function resolveServerOsUser(): string {
  try {
    return userInfo().username;
  } catch (error) {
    // Docker 的数字 UID 可能没有 passwd 条目，userInfo 会抛错并阻断 Core ready。
    // 此字段只用于展示；用有效 UID 保持 userInfo 的用户语义，其他系统错误仍由调用方处理。
    if (
      error instanceof Error &&
      "info" in error &&
      typeof error.info === "object" &&
      error.info !== null &&
      "code" in error.info &&
      error.info.code === "ENOENT" &&
      "syscall" in error.info &&
      error.info.syscall === "uv_os_get_passwd" &&
      typeof process.geteuid === "function"
    ) {
      return `uid:${process.geteuid()}`;
    }
    throw error;
  }
}

export { acquireFileLock } from "./node/atomicFileLock.js";
export { createNodeNetworkCapture, withoutNetworkCapture } from "./node/networkCapture.js";
export {
  GEN_UI_OUTPUT_ROOT_ENV,
  GEN_UI_OUTPUT_DIRECTORY,
  getGenUiOutputDirectory,
} from "./node/genUiPaths.js";
export { scanOfficialPluginCacheRoots } from "./node/officialPluginCache.js";
export {
  migrateUserSubagentMarkdown,
  migrateSubagentStateFile,
} from "./node/subagentMarkdownMigration.js";
export {
  atomicWritePrivateTextFile,
  backupCorruptFile,
  withFileLock,
  withCredentialFileRead,
  withCredentialFileMutation,
  captureCredentialFileGuard,
  type CredentialFileGuard,
  type SharedFileLockOptions,
} from "./node/privateFilePersistence.js";
export {
  createNodeSelfResourceSampler,
  NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  type NodeSelfResourceSampler,
  type NodeSelfResourceSamplerOptions,
} from "./node/nodeSelfResourceTelemetry.js";
