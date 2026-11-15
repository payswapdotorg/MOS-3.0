import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  DEFAULT_MUSE_CODE_BACKEND_SETTINGS,
  museCodeBackendSettingsSchema,
  selectMuseExecutionSurface,
  type MuseCodeBackendSettings,
  type MuseCodeCliStatus,
} from "@zcode/shared";
import {
  atomicWritePrivateTextFile,
  buildMuseChildEnv,
  resolveMuseCodeSettingsFilePath,
  resolveWindowsExecutableOnPath,
} from "@zcode/shared/node";
import type {
  IMuseCodeService,
  MuseCodeBackendView,
  MuseCodeLaunchLoginResult,
} from "./museCode.js";
import type { ZCodeAgentWorkspaceTarget } from "../zcode-agent/zcodeAgent.js";
// IMuseCodeService 实现（Issue #24 / ACR-0002）。
//
// 探测纪律：
// - 状态只来自可观察的 CLI 进程行为：`<muse> --version`（documented）与用户显式
//   配置的 statusProbeCommand；两者都带超时与输出上限，绝不带凭据、绝不回显环境。
// - 凭据红线：本服务不读 CLI 的任何存储/token；auth/contributor 字段只从探针
//   输出解析，未配置探针 = 未知（undefined），不猜测。

const VERSION_PROBE_TIMEOUT_MS = 10_000;
const STATUS_PROBE_TIMEOUT_MS = 10_000;
const PROBE_OUTPUT_LIMIT = 16 * 1024;
const MUSE_EXECUTABLE_ENV = "ZCODE_MUSE_EXECUTABLE";

export interface MuseCodeProbeResult {
  exitCode: number | null;
  spawnError?: string;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface CreateMuseCodeServiceDeps {
  env?: NodeJS.ProcessEnv;
  logger?: {
    info?(message: string, context?: Record<string, unknown>): void;
    warn?(message: string, context?: Record<string, unknown>): void;
  };
  settingsPath?: string;
  /** 测试注入：覆盖进程探测。 */
  runProbe?: (executable: string, args: readonly string[], timeoutMs: number) => Promise<MuseCodeProbeResult>;
  /** 测试注入：覆盖设置文件路径解析。 */
  resolveSettingsPath?: (env: NodeJS.ProcessEnv) => string;
  /** CLI 能力查询（zcodeAgentService.supportsExecutionBackendMuseCode）。 */
  supportsBackendCapability?: (target: ZCodeAgentWorkspaceTarget) => Promise<boolean>;
  /** 测试注入：覆盖登录命令启动。 */
  launchDetached?: (executable: string, args: readonly string[]) => boolean;
}

interface ProbeRunner {
  (executable: string, args: readonly string[], timeoutMs: number): Promise<MuseCodeProbeResult>;
}

export function createMuseCodeService(deps: CreateMuseCodeServiceDeps = {}): IMuseCodeService {
  const env = deps.env ?? process.env;
  const logger = deps.logger;
  const settingsPath = deps.settingsPath ?? (deps.resolveSettingsPath ?? resolveMuseCodeSettingsFilePath)(env);
  const runProbe: ProbeRunner =
    deps.runProbe ??
    ((executable, args, timeoutMs) => runProcessProbe(executable, args, timeoutMs, env));
  const launchDetached =
    deps.launchDetached ?? ((executable, args) => defaultLaunchDetached(executable, args, env));
  let cachedStatus: MuseCodeCliStatus | undefined;

  const readSettings = async (): Promise<MuseCodeBackendSettings> => {
    try {
      const raw = await readFile(settingsPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const result = museCodeBackendSettingsSchema.safeParse(parsed);
      return result.success ? result.data : DEFAULT_MUSE_CODE_BACKEND_SETTINGS;
    } catch {
      return DEFAULT_MUSE_CODE_BACKEND_SETTINGS;
    }
  };

  const writeSettings = async (settings: MuseCodeBackendSettings): Promise<void> => {
    await atomicWritePrivateTextFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  };

  const resolveExecutable = (settings: MuseCodeBackendSettings): string => {
    const override = env[MUSE_EXECUTABLE_ENV]?.trim();
    if (override && override.length > 0) return override;
    return settings.executablePath?.trim() || "muse";
  };

  const probeStatus = async (): Promise<MuseCodeCliStatus> => {
    const settings = await readSettings();
    const command = resolveExecutable(settings);
    const executable = isAbsolute(command)
      ? command
      : process.platform === "win32"
        ? (resolveWindowsExecutableOnPath(command, env) ?? command)
        : command;
    let probe: MuseCodeProbeResult;
    try {
      probe = await runProbe(executable, ["--version"], VERSION_PROBE_TIMEOUT_MS);
    } catch (error) {
      logger?.warn?.("Muse Code version probe failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "muse_code.version_probe.failed",
        module: "services.muse-code",
      });
      return unavailableStatus("versionProbeFailed");
    }
    if (probe.timedOut) {
      return unavailableStatus("versionProbeTimeout");
    }
    if (probe.spawnError) {
      // ENOENT 等启动失败按未安装收口（fail-closed：展示为不可用）。
      return unavailableStatus("executableNotFound");
    }
    if (probe.exitCode !== 0) {
      return unavailableStatus("versionProbeFailed");
    }
    const version = parseVersion(probe.stdout);
    const status: MuseCodeCliStatus = {
      state: "installed",
      checkedAt: new Date().toISOString(),
      ...(version ? { version } : {}),
      ...(isAbsolute(executable) || executable !== command ? { executablePath: executable } : {}),
    };
    if (settings.statusProbeCommand && settings.statusProbeCommand.length > 0) {
      const probeCommand = settings.statusProbeCommand;
      const statusExecutable = isAbsolute(probeCommand[0]!)
        ? probeCommand[0]!
        : process.platform === "win32"
          ? (resolveWindowsExecutableOnPath(probeCommand[0]!, env) ?? probeCommand[0]!)
          : probeCommand[0]!;
      try {
        const statusProbe = await runProbe(
          statusExecutable,
          probeCommand.slice(1),
          STATUS_PROBE_TIMEOUT_MS,
        );
        if (statusProbe.timedOut || statusProbe.spawnError || statusProbe.exitCode !== 0) {
          return { ...status, probeIssueCode: "statusProbeFailed" };
        }
        const parsed = parseStatusProbeOutput(statusProbe.stdout);
        return parsed ? { ...status, ...parsed } : status;
      } catch {
        return { ...status, probeIssueCode: "statusProbeFailed" };
      }
    }
    return status;
  };

  const getView = async (
    target?: ZCodeAgentWorkspaceTarget,
    options?: { forceRecheck?: boolean },
  ): Promise<MuseCodeBackendView> => {
    if (!cachedStatus || options?.forceRecheck) {
      cachedStatus = await probeStatus();
    }
    const settings = await readSettings();
    const backendSupported =
      target && deps.supportsBackendCapability
        ? await deps.supportsBackendCapability(target).catch(() => false)
        : false;
    // 执行面预判（R1；展示用途）：与 bootstrap 端口同一判定函数。版本未知/探针失败
    // → muse-exec（回退面）。逐轮真相由端口 result.surface 回传。
    const executionSurface = selectMuseExecutionSurface({
      cliVersion: cachedStatus.version,
      settings,
    });
    return { backendSupported, executionSurface, settings, status: cachedStatus };
  };

  return {
    async getView(target) {
      return getView(target);
    },
    async recheck(target) {
      cachedStatus = undefined;
      return getView(target, { forceRecheck: true });
    },
    async saveSettings(settings) {
      const parsed = museCodeBackendSettingsSchema.parse(settings);
      await writeSettings(parsed);
      // 可执行入口/探针命令变化后，旧状态不再可信；下次 getView 重新探测。
      cachedStatus = undefined;
      return parsed;
    },
    async launchLogin(): Promise<MuseCodeLaunchLoginResult> {
      const settings = await readSettings();
      const command = settings.loginCommand?.[0]?.trim();
      if (!command) {
        return { launched: false, reason: "loginCommandNotConfigured" };
      }
      const args = settings.loginCommand?.slice(1) ?? [];
      const executable = isAbsolute(command)
        ? command
        : process.platform === "win32"
          ? (resolveWindowsExecutableOnPath(command, env) ?? command)
          : command;
      try {
        const launched = launchDetached(executable, args);
        return launched ? { launched: true } : { launched: false, reason: "launchFailed" };
      } catch (error) {
        logger?.warn?.("Muse Code login command launch failed", {
          errorMessage: error instanceof Error ? error.message : String(error),
          event: "muse_code.login.launch_failed",
          module: "services.muse-code",
        });
        return { launched: false, reason: "launchFailed" };
      }
    },
  };
}

function unavailableStatus(probeIssueCode: NonNullable<MuseCodeCliStatus["probeIssueCode"]>): MuseCodeCliStatus {
  return {
    state: "unavailable",
    checkedAt: new Date().toISOString(),
    probeIssueCode,
  };
}

function parseVersion(stdout: string): string | undefined {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  // `muse version 1.2.3` / `muse 1.2.3` / `1.2.3`：取首个以数字开头的 token。
  const versionMatch = firstLine.match(/\d[^\s]*/);
  const normalized = (versionMatch ? versionMatch[0] : firstLine).slice(0, 128);
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * 状态探针输出的宽容解析：JSON 优先（authenticated/contributorMode/planLabel 或
 * 常见同义键），文本回退（signed in / contributor 启发式）。解析不出任何字段 →
 * undefined（保持未知，不猜测）。
 */
function parseStatusProbeOutput(
  stdout: string,
): Pick<MuseCodeCliStatus, "authenticated" | "contributorMode" | "planLabel"> | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const authenticated = readBoolean(record, ["authenticated", "signedIn", "loggedIn"]);
      const contributorMode = readBoolean(record, ["contributorMode", "contributor"]);
      const planLabel = readStringField(record, ["planLabel", "plan", "mode"]);
      if (authenticated === undefined && contributorMode === undefined && planLabel === undefined) {
        return undefined;
      }
      return {
        ...(authenticated !== undefined ? { authenticated } : {}),
        ...(contributorMode !== undefined ? { contributorMode } : {}),
        ...(planLabel !== undefined ? { planLabel } : {}),
      };
    }
  } catch {
    // 非 JSON：走文本启发式。
  }
  const lower = trimmed.toLowerCase();
  const signedOut = /signed out|not authenticated|not logged in|not signed in/.test(lower);
  const signedIn = /signed in|authenticated|logged in/.test(lower);
  const contributor = /contributor/.test(lower);
  if (!signedIn && !signedOut && !contributor) return undefined;
  return {
    ...(signedIn ? { authenticated: true } : signedOut ? { authenticated: false } : {}),
    ...(contributor ? { contributorMode: true } : {}),
  };
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 128);
    }
  }
  return undefined;
}

async function runProcessProbe(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MuseCodeProbeResult> {
  return await new Promise<MuseCodeProbeResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // 环境隔离（PR #27 评审 R5）：探针子进程与执行端口同策略——允许清单构造，
        // Host 集成凭据不外流；登录态经 USERPROFILE/APPDATA/HOME 保持。
        env: buildMuseChildEnv(env),
      });
    } catch (error) {
      resolve({
        exitCode: null,
        spawnError: error instanceof Error ? error.message : String(error),
        stderr: "",
        stdout: "",
        timedOut: false,
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < PROBE_OUTPUT_LIMIT) stdout += chunk.toString("utf8").slice(0, PROBE_OUTPUT_LIMIT);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < PROBE_OUTPUT_LIMIT) stderr += chunk.toString("utf8").slice(0, PROBE_OUTPUT_LIMIT);
    });
    child.once("error", (error: Error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, spawnError: error.message, stderr, stdout, timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stderr, stdout, timedOut });
    });
  });
}

function defaultLaunchDetached(executable: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const child = spawn(executable, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // 环境隔离（R5）：与探针/执行端口同策略。
      env: buildMuseChildEnv(env),
    });
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
}
