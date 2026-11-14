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
