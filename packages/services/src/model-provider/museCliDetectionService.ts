import { execFile, spawn } from "node:child_process";
import type { IMuseCliDetectionService, MuseCliStatus } from "./museCliDetection.js";

/** 各探测命令的超时：版本 8s，usage/logout 12s（documented CLI 命令，慢机首次启动留余量）。 */
const MUSE_VERSION_TIMEOUT_MS = 8_000;
const MUSE_USAGE_TIMEOUT_MS = 12_000;
const MUSE_LOGOUT_TIMEOUT_MS = 12_000;
/** 失败摘要上限：错误信息必须是有界文本，且不得携带 env / 路径。 */
const MUSE_ERROR_MESSAGE_MAX_LENGTH = 200;
/** CLI 未登录时 documented 输出中的标记片段。 */
const MUSE_NOT_LOGGED_IN_MARKER = "not logged in";
const MUSE_VERSION_PATTERN = /Muse Code\s+(\d+\.\d+\.\d+(?:[-+.\w])*)/i;

/** ZCODE_MUSE_CLI_PATH 覆盖探测命令；缺省按平台选择 muse / muse.exe。 */
function resolveMuseCliCommand(): string {
  const override = process.env.ZCODE_MUSE_CLI_PATH?.trim();
  if (override) return override;
  return process.platform === "win32" ? "muse.exe" : "muse";
}

type MuseCliRunResult =
  | { readonly outcome: "success"; readonly stdout: string; readonly stderr: string }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "failure"; readonly message: string; readonly output: string };

/** 把 CLI 原始输出折叠成单行有界摘要；覆盖命令路径的 env 值必须被掩码。 */
function boundMuseCliMessage(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const override = process.env.ZCODE_MUSE_CLI_PATH?.trim();
  const masked = override ? normalized.split(override).join("[muse-cli]") : normalized;
  const bounded =
    masked.length > MUSE_ERROR_MESSAGE_MAX_LENGTH
      ? `${masked.slice(0, MUSE_ERROR_MESSAGE_MAX_LENGTH - 1)}…`
      : masked;
  return bounded || "muse cli command failed";
}

/** 执行 documented CLI 命令；只返回退出事实与输出文本，不做任何日志。 */
function runMuseCli(
  command: string,
  args: readonly string[],
  timeout: number,
): Promise<MuseCliRunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${String(stderr ?? "")}\n${String(stdout ?? "")}`;
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            resolve({ outcome: "not-found" });
            return;
          }
          resolve({
            outcome: "failure",
            message: boundMuseCliMessage(String(stderr ?? "") || error.message),
            output,
          });
          return;
        }
        resolve({ outcome: "success", stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

function parseMuseCliVersion(stdout: string): string | undefined {
  const match = MUSE_VERSION_PATTERN.exec(stdout);
  return match?.[1];
}

/** usage JSON 只接受普通对象（订阅额度事实），数组/标量一律视为解析失败。 */
function parseMuseUsageJson(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function containsNotLoggedInMarker(output: string): boolean {
  return output.toLowerCase().includes(MUSE_NOT_LOGGED_IN_MARKER);
}

/**
 * Muse CLI 探测服务（Host 侧实现）。
 *
 * 全链路只使用 documented CLI 命令，不导入 @muse-code/sdk，不读写 MOS 凭据。
 * 探测结果只包含安装/版本/登录态/额度 JSON 摘要；错误信息有界且不携带 env 与路径。
 */
export function createMuseCliDetectionService(): IMuseCliDetectionService {
  return {
    getStatus: async () => {
      const command = resolveMuseCliCommand();
      const versionResult = await runMuseCli(command, ["--version"], MUSE_VERSION_TIMEOUT_MS);
      if (versionResult.outcome === "not-found") {
        return { installed: false };
      }
      const installed = true;
      const version =
        versionResult.outcome === "success" ? parseMuseCliVersion(versionResult.stdout) : undefined;
      const versioned: MuseCliStatus =
        version === undefined ? { installed } : { installed, version };

      const usageResult = await runMuseCli(command, ["usage", "--json"], MUSE_USAGE_TIMEOUT_MS);
      if (usageResult.outcome === "not-found") {
        // 两次探测之间 CLI 被卸载：以未安装收口。
        return { installed: false };
      }
      if (usageResult.outcome === "success") {
        const usage = parseMuseUsageJson(usageResult.stdout);
        if (usage) {
          return { ...versioned, signedIn: true, usage };
        }
        return {
          ...versioned,
          error: boundMuseCliMessage(usageResult.stdout || "muse usage returned non-object json"),
        };
      }
      if (containsNotLoggedInMarker(usageResult.output)) {
        return { ...versioned, signedIn: false };
      }
      return { ...versioned, error: usageResult.message };
    },

    startLogin: async () => {
      const command = resolveMuseCliCommand();
      // 浏览器设备码流程由 CLI 自己驱动（自动开浏览器）；Host 只负责拉起进程并立即返回。
      // spawn 的 ENOENT 是异步 error 事件，用 spawn/error 双事件保证“立即返回但能捕获失败”。
      return await new Promise<{ readonly started: boolean; readonly message?: string }>(
        (resolve) => {
          let child;
          try {
            child = spawn(command, ["login"], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
          } catch (error) {
            resolve({
              started: false,
              message: boundMuseCliMessage(
                error instanceof Error ? error.message : "muse login spawn failed",
              ),
            });
            return;
          }
          let settled = false;
          const finish = (result: { readonly started: boolean; readonly message?: string }) => {
            if (settled) return;
            settled = true;
            resolve(result);
          };
          child.once("error", (error) => {
            finish({
              started: false,
              message:
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? "muse cli not installed"
                  : boundMuseCliMessage(error.message),
            });
          });
          child.once("spawn", () => {
            // detach：进程脱离 Host 生命周期，登录页关闭与否不影响桌面。
            child.unref();
            finish({ started: true });
          });
        },
      );
    },

    logout: async () => {
      const command = resolveMuseCliCommand();
      const result = await runMuseCli(command, ["logout"], MUSE_LOGOUT_TIMEOUT_MS);
      if (result.outcome === "success") {
        return { ok: true };
      }
      if (result.outcome === "not-found") {
        return { ok: false, message: "muse cli not installed" };
      }
      return { ok: false, message: result.message };
    },
  };
}
