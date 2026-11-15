import {
  DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
  museCodeBackendSettingsSchema,
  type MuseCodeBackendSettings,
} from "@zcode/shared";
import { resolveMuseCodeSettingsFilePath } from "@zcode/shared/node";
// Muse Code 后端设置的宽容读取（CLI 端口侧）。
// 设置文件由 Host 侧 IMuseCodeService 持久化（权威写方）；
// 本模块每次执行前只读（timeout / maxModelSteps / executablePath），
// 读取失败一律回落默认值，绝不阻断会话路径（fail-open 读取，行为仍 fail-closed）。

export {
  MUSE_CODE_SETTINGS_FILE_ENV,
  defaultMuseCodeSettingsFilePath,
  resolveMuseCodeSettingsFilePath,
} from "@zcode/shared/node";

/** 宽容读取：文件缺失/损坏/schema 不匹配都回落默认值。 */
export async function readMuseCodeBackendSettings(
  env: NodeJS.ProcessEnv,
): Promise<MuseCodeBackendSettings> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(resolveMuseCodeSettingsFilePath(env), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = museCodeBackendSettingsSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_MUSE_CODE_BACKEND_SETTINGS;
  } catch {
    return DEFAULT_MUSE_CODE_BACKEND_SETTINGS;
  }
}
