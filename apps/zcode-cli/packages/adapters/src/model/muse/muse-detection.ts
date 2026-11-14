/**
 * Muse Code CLI 探测（ACR-0002）：
 *
 * - `probeMuseCliCommands`：只用 documented CLI 命令（`muse --version`、
 *   `muse usage --json`），不启动 MSP、不触碰 SDK、不读取任何凭证存储。
 *   供 Settings 状态卡（Host 侧）与运行前快速检查使用。
 * - `probeMuseRuntime`：SDK 深探测——握手 + `model/list` + `usage/read`，
 *   给出宿主可达性、模型目录（含 Contributor 变体是否可见）与订阅用量。
 *   供 testModelConnectivity 的 Muse 分支使用（在 CLI 进程内执行）。
 *
 * 所有探测都有界（超时）且不打印密钥；`muse usage` 只输出订阅额度事实。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MuseClient } from "@muse-code/sdk";

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 8_000;
const USAGE_TIMEOUT_MS = 12_000;
const RUNTIME_PROBE_TIMEOUT_MS = 20_000;

export interface MuseCliCommandProbeResult {
  /** `muse --version` 是否可用（PATH/指定路径上存在并可执行）。 */
  readonly installed: boolean;
  readonly version?: string;
  /** `muse usage --json`：0 退出 + JSON 解析成功 → true；明确未登录 → false。 */
  readonly signedIn?: boolean;
  /** 订阅额度原文（已解析的 JSON 对象；字段以本机 CLI 版本为准，容忍未知字段）。 */
  readonly usage?: Record<string, unknown>;
  readonly error?: string;
}

export interface MuseRuntimeProbeResult {
  readonly hostReachable: boolean;
  readonly models: readonly MuseRuntimeModelSummary[];
  /** 目录中是否存在 *-contributor 变体（Contributor 模式可用的信号）。 */
  readonly contributorModelsAvailable: boolean;
  /** SDK usage/read 的最近观测（未登录/未观测时缺省）。 */
  readonly usage?: Record<string, unknown>;
  readonly error?: string;
}

export interface MuseRuntimeModelSummary {
  readonly modelId: string;
  readonly displayLabel?: string;
  readonly contextLimit?: number;
  readonly outputLimit?: number;
}

export interface MuseProbeOptions {
  readonly museBin?: string;
  readonly env?: Record<string, string | undefined>;
}

function resolveMuseCommand(options: MuseProbeOptions): string {
  return (
    options.museBin ??
    options.env?.["ZCODE_MUSE_CLI_PATH"] ??
    (process.platform === "win32" ? "muse.exe" : "muse")
  );
}

/** `Muse Code 1.4.20 (1.4.20-R8619.1)` → `1.4.20`。 */
export function parseMuseVersionOutput(output: string): string | undefined {
  const match = output.match(/Muse Code\s+(\d+\.\d+\.\d+(?:[-+.\w])*)/i);
  return match?.[1];
}

/** 解析 `muse usage --json`；失败返回 undefined（由调用方结合退出码分类）。 */
export function parseMuseUsageJson(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function probeMuseCliCommands(options: MuseProbeOptions = {}): Promise<MuseCliCommandProbeResult> {
  const command = resolveMuseCommand(options);
  const result: MuseCliCommandProbeResult = { installed: false };
  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync(command, ["--version"], { timeout: VERSION_TIMEOUT_MS });
    version = parseMuseVersionOutput(stdout);
  } catch (error) {
    return {
      installed: false,
      error: `muse --version failed: ${(error as Error).message}`,
    };
  }
  let usage: Record<string, unknown> | undefined;
  let signedIn: boolean | undefined;
  let usageError: string | undefined;
  try {
    const { stdout } = await execFileAsync(command, ["usage", "--json"], {
      timeout: USAGE_TIMEOUT_MS,
    });
    usage = parseMuseUsageJson(stdout);
    signedIn = usage !== undefined;
  } catch (error) {
    const message = (error as { stderr?: string; message?: string }).stderr ??
      (error as Error).message ??
      "";
    if (message.includes("not logged in")) {
      signedIn = false;
    } else {
      usageError = `muse usage failed: ${message.slice(0, 200)}`;
    }
  }
  return {
    installed: true,
    ...(version !== undefined ? { version } : {}),
    ...(signedIn !== undefined ? { signedIn } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(usageError !== undefined ? { error: usageError } : {}),
  };
}

export async function probeMuseRuntime(options: MuseProbeOptions = {}): Promise<MuseRuntimeProbeResult> {
  const command = resolveMuseCommand(options);
  let client: MuseClient | undefined;
  try {
    const probe = async (): Promise<MuseRuntimeProbeResult> => {
      client = await MuseClient.spawn({
        args: ["serve"],
        clientInfo: { name: "zcode_probe", version: "0.0.0" },
        museBin: command,
      });
      const listed = await client.listModels();
      const models: MuseRuntimeModelSummary[] = (listed.models ?? []).map((entry) => ({
        modelId: entry.modelId,
        ...(entry.displayLabel !== undefined ? { displayLabel: entry.displayLabel } : {}),
        ...(typeof entry.contextLimit === "number" ? { contextLimit: entry.contextLimit } : {}),
        ...(typeof (entry as { outputLimit?: number }).outputLimit === "number"
          ? { outputLimit: (entry as { outputLimit?: number }).outputLimit }
          : {}),
      }));
      let usage: Record<string, unknown> | undefined;
      try {
        const usageRead = await client.readUsage();
        const observed = (usageRead as { usage?: Record<string, unknown> }).usage;
        if (observed !== undefined) usage = observed;
      } catch {
        // usage/read 失败不影响模型目录结论。
      }
      return {
        hostReachable: true,
        models,
        contributorModelsAvailable: models.some((model) => model.modelId.endsWith("-contributor")),
        ...(usage !== undefined ? { usage } : {}),
      };
    };
    return await withTimeout(probe(), RUNTIME_PROBE_TIMEOUT_MS);
  } catch (error) {
    return {
      hostReachable: false,
      models: [],
      contributorModelsAvailable: false,
      error: (error as Error).message?.slice(0, 400) ?? "muse serve probe failed",
    };
  } finally {
    if (client !== undefined) {
      void client.close().catch(() => undefined);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`muse probe timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
