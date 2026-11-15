import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { realpath as realpathCallback } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { MuseCodeBackendSettings } from "@zcode/shared";
import { buildMuseChildEnv } from "@zcode/shared/node";
// Muse CLI 可执行入口解析 / workspace 收敛 / 版本探针（Issue #24 / ACR-0002；
// PR #27 评审 R1/R4/R5——exec 与 MSP 两个端口实现共用，不复制判定；
// 评审 rev. 3：workspace 判定增加物理（realpath）层，词法比较不可绕过边界）。

const MUSE_EXECUTABLE_ENV = "ZCODE_MUSE_EXECUTABLE";
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const VERSION_OUTPUT_LIMIT = 4 * 1024;

/** 端口启动失败的稳定原因码（fail-closed；core/Host 侧不做重试）。 */
export type MuseExecStartupIssueCode =
  | "executableNotFound"
  | "spawnFailed"
  /** workingDirectory 越出 workspaceRoot（R4：MOS 侧收敛校验，绝不 spawn）。 */
  | "workspaceViolation";

export class MuseExecStartupError extends Error {
  constructor(
    readonly issueCode: MuseExecStartupIssueCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MuseExecStartupError";
  }
}

/**
 * 解析 muse 可执行入口（exec 端口 / MSP 端口 / 版本探针共用）：
 * env 覆盖 > settings 绝对路径 > PATH 解析（Windows 只接受可直接 spawn 的
 * .exe/.com，不 spawn .cmd/.bat shim——无 shell 纪律）。
 * 返回 null = 找不到（调用方 fail-closed）。
 */
export function resolveMuseExecutableEntry(
  env: NodeJS.ProcessEnv,
  settings: MuseCodeBackendSettings,
  requestOverride?: string,
): string | null {
  const fromOverride = requestOverride?.trim() || env[MUSE_EXECUTABLE_ENV]?.trim();
  const command =
    fromOverride && fromOverride.length > 0
      ? fromOverride
      : settings.executablePath?.trim() || "muse";
  if (isAbsolute(command)) return command;
  if (process.platform === "win32") {
    return resolveOnWindowsPath(env, command);
  }
  return command;
}

/** 物理别名解析（symlink / Windows junction / reparse point 都经 realpath 归一）。 */
export type MuseRealpath = (path: string) => Promise<string>;

/** 缺省实现：node fs.promises.realpath（解析失败 = reject）。 */
const defaultRealpath: MuseRealpath = (path) => realpathCallback(path);

/**
 * workspace 收敛的词法判定（同步层；物理复核见 assertMuseWorkspaceContainment）：
 * workingDirectory 必须位于 workspaceRoot 内——规范化分隔符（win32 反斜杠）与
 * 盘符大小写；相对路径 containment 判定；相等（会话 cwd == 根）合法。
 */
export function isInsideMuseWorkspace(
  workingDirectory: string,
  workspaceRoot: string,
): boolean {
  const normalize = (value: string): string => {
    const resolved = resolve(value).replace(/\\/g, "/");
    // win32 盘符大小写不敏感；POSIX 保持大小写。
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const normalizedCwd = normalize(workingDirectory);
  const normalizedRoot = normalize(workspaceRoot);
  if (normalizedCwd === normalizedRoot) return true;
  const rel = relative(normalizedRoot, normalizedCwd);
  // 统一 / 分隔后：".." 或以 "../" 开头 = 越界；绝对路径（含盘符切换）同样越界。
  return rel.length > 0 && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

/**
 * workspace 根的词法归一比较（纯函数）：分隔符（\\→/）、尾分隔符、win32 盘符
 * 大小写、`\\?\`/`\\?\UNC\` 设备路径前缀都归一后全串相等才为 true。作为唯一
 * 比较手段时它只能保守判定（别名会假阴性）；配合 isSameMuseWorkspaceRoot 的
 * 物理层后，词法相等 ⇒ 物理相等（同串同路径），不存在「词法相等但物理不同」
 * 的绕过面。
 */
export function sameMuseWorkspaceRootLexically(
  storedRoot: string,
  currentRoot: string,
): boolean {
  // 空根（无 workspace）永不判同（fail-closed；异步层另有同一守卫，双保险）。
  if (storedRoot.length === 0 || currentRoot.length === 0) return false;
  const normalize = (value: string): string => {
    let normalized = value.trim().replace(/\\/g, "/");
    // Windows 设备路径前缀不参与比较（两侧同规则剥除）。
    if (normalized.startsWith("//?/UNC/")) {
      normalized = `//${normalized.slice("//?/UNC/".length)}`;
    } else if (normalized.startsWith("//?/")) {
      normalized = normalized.slice(4);
    }
    while (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(storedRoot) === normalize(currentRoot);
}

/**
 * workspace 根一致性（评审 rev. 3——resume 门控用）：
 * 1. 词法归一相等 → 同根（同串同路径，无绕过面）。
 * 2. 否则尝试物理归一（realpath 解析 symlink/junction 别名）：两者都解析成功且
 *    归一后相等 → 同根（同一物理目录的别名路径不丢连续性）。
 * 3. 任一解析失败 / 归一后不等 → 不同根（fail-closed：不续接，连续性重置为
 *    当前根内的新会话，绝不跨 workspace 边界续接）。
 */
export async function isSameMuseWorkspaceRoot(
  storedRoot: string,
  currentRoot: string,
  deps: { realpath?: MuseRealpath } = {},
): Promise<boolean> {
  if (storedRoot.length === 0 || currentRoot.length === 0) return false;
  if (sameMuseWorkspaceRootLexically(storedRoot, currentRoot)) return true;
  const realpath = deps.realpath ?? defaultRealpath;
  try {
    const [storedResolved, currentResolved] = await Promise.all([
      realpath(storedRoot),
      realpath(currentRoot),
    ]);
    return sameMuseWorkspaceRootLexically(storedResolved, currentResolved);
  } catch {
    return false;
  }
}

/**
 * workspace 收敛校验（R4；rev. 3 增加物理复核）：workingDirectory 必须位于
 * workspaceRoot 内。
 * - 词法层（同步判定）：规范化分隔符（win32 反斜杠）与盘符大小写；相对路径
 *   containment 判定；相等（会话 cwd == 根）合法。
 * - 物理层（词法通过后复核）：cwd 与根都 realpath 解析成功时，解析后的 cwd
 *   必须仍位于解析后的根内——词法在界内、物理在界外（如 workspace 内的
 *   symlink/junction 指向根外目录）= 越界，fail-closed。任一路径解析失败
 *   （不存在/不可达/权限）时退回词法判定（spawn 自身的失败是自然兜底），
 *   不额外阻断既有合法场景。
 * - 越界 → workspaceViolation（fail-closed，不 spawn）。
 */
export async function assertMuseWorkspaceContainment(
  workingDirectory: string,
  workspaceRoot: string,
  deps: { realpath?: MuseRealpath } = {},
): Promise<void> {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    throw new MuseExecStartupError(
      "workspaceViolation",
      "Muse Code delegated execution requires a workspace root; this session has none.",
    );
  }
  if (!isInsideMuseWorkspace(workingDirectory, workspaceRoot)) {
    throw new MuseExecStartupError(
      "workspaceViolation",
      `Muse Code delegated execution requires the working directory to stay inside the workspace root (working directory "${workingDirectory}" is outside "${workspaceRoot}").`,
    );
  }
  const realpath = deps.realpath ?? defaultRealpath;
  let physicalCheck: boolean | undefined;
  try {
    const [resolvedCwd, resolvedRoot] = await Promise.all([
      realpath(workingDirectory),
      realpath(workspaceRoot),
    ]);
    physicalCheck = isInsideMuseWorkspace(resolvedCwd, resolvedRoot);
  } catch {
    physicalCheck = undefined;
  }
  if (physicalCheck === false) {
    throw new MuseExecStartupError(
      "workspaceViolation",
      `Muse Code delegated execution requires the working directory to stay inside the workspace root (working directory "${workingDirectory}" resolves through a symlink/junction to a location outside "${workspaceRoot}").`,
    );
  }
}

/** Windows PATH 解析：只接受可直接 spawn 的可执行文件（.exe/.com）。 */
function resolveOnWindowsPath(env: NodeJS.ProcessEnv, command: string): string | null {
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

export interface MuseVersionProbeResult {
  version?: string;
  probeIssueCode?: "executableNotFound" | "versionProbeFailed" | "versionProbeTimeout";
}

/**
 * `muse --version` 探针（documented；执行面选择 R1 用）：
 * - 子进程环境走 buildMuseChildEnv（R5 允许清单，与执行端口同策略）。
 * - 进程内按可执行入口缓存（CLI 换代 = 设置路径变化或进程重启）。
 * - 任何失败返回 issueCode（调用方回退 exec 面，绝不猜测版本）。
 */
export async function probeMuseCliVersion(
  executable: string,
  env: NodeJS.ProcessEnv,
): Promise<MuseVersionProbeResult> {
  const cached = versionCache.get(executable);
  if (cached) return cached;
  const result = await runVersionProbe(executable, env);
  versionCache.set(executable, result);
  return result;
}

/** 测试注入：清空版本探针缓存。 */
export function clearMuseCliVersionCache(): void {
  versionCache.clear();
}

const versionCache = new Map<string, MuseVersionProbeResult>();

function runVersionProbe(
  executable: string,
  env: NodeJS.ProcessEnv,
): Promise<MuseVersionProbeResult> {
  return new Promise<MuseVersionProbeResult>((resolve) => {
    let stdout = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const settle = (result: MuseVersionProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let timer: ReturnType<typeof setTimeout>;
    try {
      child = spawn(executable, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: buildMuseChildEnv(env),
      });
    } catch {
      resolve({ probeIssueCode: "versionProbeFailed" });
      return;
    }
    timer = setTimeout(() => {
      terminateChildTree(child);
      settle({ probeIssueCode: "versionProbeTimeout" });
    }, VERSION_PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < VERSION_OUTPUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.once("error", (error: Error) => {
      settle({
        probeIssueCode:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "executableNotFound"
            : "versionProbeFailed",
      });
    });
    child.once("close", (code) => {
      if (code !== 0) {
        settle({ probeIssueCode: "versionProbeFailed" });
        return;
      }
      const version = parseVersionOutput(stdout);
      settle(version ? { version } : { probeIssueCode: "versionProbeFailed" });
    });
  });
}

/** `muse version 1.2.3` / `muse 1.2.3` / `1.2.3`：取首个 x.y.z 串。 */
function parseVersionOutput(stdout: string): string | undefined {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  const match = firstLine.match(/\d+\.\d+\.\d+[^\s]*/);
  const normalized = (match ? match[0] : firstLine).slice(0, 128);
  return normalized.length > 0 ? normalized : undefined;
}

/** 进程树终止（与 muse-exec-process 相同收口；探针超时复用）。 */
function terminateChildTree(child: ReturnType<typeof spawn>): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (typeof pid !== "number") return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill());
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
