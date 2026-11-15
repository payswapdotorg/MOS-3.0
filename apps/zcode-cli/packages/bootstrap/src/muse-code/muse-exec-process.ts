import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  MuseExecutionPort,
  MuseExecHandlers,
  MuseExecRequest,
  MuseExecRunResult,
  MuseExecStreamEvent,
  MuseExecApprovalPosture,
} from "@zcode/contracts";
import {
  DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS,
  type MuseCodeBackendSettings,
} from "@zcode/shared";
import { buildMuseChildEnv } from "@zcode/shared/node";
import { parseMuseExecJsonlLine } from "./muse-exec-jsonl.js";
import { readMuseCodeBackendSettings } from "./muse-code-settings.js";
import {
  MuseExecStartupError,
  assertMuseWorkspaceContainment,
  canResumeMuseSessionMapping,
  resolveMuseWorkspaceRootPhysical,
  resolveMuseExecutableEntry,
} from "./muse-exec-support.js";
import {
  createFileMuseSessionStore,
  lookupMuseSessionMapping,
  recordMuseSessionMapping,
  type MuseSessionStore,
} from "./muse-session-store.js";
// Muse Code CLI `muse exec --json` 子进程执行端口（Issue #24 / ACR-0002；
// PR #27 评审修订 R2–R6）。
//
// 进程纪律（对齐 services/zcode-agent/zcodeStdioTransport.ts 的收口语义，CLI 进程内自持有）：
// - 绝不 shell:true；显式 argv；Windows 上不 spawn .cmd/.bat shim（CVE 修复后 Node
//   拒绝无 shell 的 .cmd，MOS 也不为此打开 shell），只支持可执行文件，用户可在
//   设置里填绝对路径覆盖。
// - cwd 固定为会话工作目录；stdin 忽略，提示经 documented `--prompt-file` 临时文件
//   传入，避免 argv 长度/转义问题。
// - workspace 收敛（R4；评审 rev. 3 修正）：workingDirectory 必须位于 workspaceRoot
//   内（spawn 前词法 + 物理两层校验，fail-closed），并把 documented `--workspace
//   <workspaceRoot>` 传给 CLI（Meta 当前配置文档将 `--workspace <path>` 列为
//   interactive/headless 通用的 common flag——早先「无此旗标」的记录有误，已在
//   evidence §1 更正）——CLI 侧边界与 MOS 策略根钉在同一目录（双保险）。
// - 环境隔离（R5）：子进程环境经 buildMuseChildEnv 允许清单，Host 集成凭据不外流。
// - 审批姿态（R3）：fail-closed（缺省）不传任何审批旗标；unattended-sandboxed 附加
//   documented `--disable-approval`（sandbox 保持开启）。`--yolo` 永不出现在 argv。
// - 会话连续性（R2；验证轮修正 A 加严）：优先续接持久映射的 muse 会话（documented
//   `--session-id`）——但映射持久化 canonical 物理根，每次续接都与当前请求根的
//   **实时物理解析结果**比较（无词法同串捷径，symlink retarget 防护）；不一致 =
//   放弃续接、当前根内开新会话（sessionWorkspaceMismatch 如实回传），绝不跨
//   workspace 边界续接旧会话；信封级候选 session id 从 JSONL 捕获并回写映射。
// - abort/超时 → 进程树终止（POSIX 进程组 SIGTERM→SIGKILL；Windows taskkill /T /F）。
// - stderr 只保留尾部 64KB 诊断窗口；stdout 逐行 JSONL，超长行按 unknown 计数。

const STDERR_LIMIT = 64 * 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const TREE_FORCE_AFTER_MS = 5_000;

export interface MuseExecProcessDeps {
  env?: NodeJS.ProcessEnv;
  /** 测试注入：覆盖设置读取。 */
  readSettings?: (env: NodeJS.ProcessEnv) => Promise<MuseCodeBackendSettings>;
  /** 测试注入：覆盖会话映射存储。 */
  sessionStore?: MuseSessionStore;
  /** 测试注入：写映射失败时的告警出口（缺省静默降级为本轮不可续接）。 */
  onSessionMapWriteError?: (error: unknown) => void;
}

/** exec 面端口实现（`muse exec --json`）。 */
export function createMuseExecProcessPort(deps: MuseExecProcessDeps = {}): MuseExecutionPort {
  const env = deps.env ?? process.env;
  const readSettings = deps.readSettings ?? readMuseCodeBackendSettings;
  const sessionStore = deps.sessionStore ?? createFileMuseSessionStore(env);

  return {
    async runMuseExec(
      request: MuseExecRequest,
      handlers: MuseExecHandlers,
    ): Promise<MuseExecRunResult> {
      // workspace 收敛（R4）：越界绝不 spawn（词法 + 物理两层）。
      await assertMuseWorkspaceContainment(request.workingDirectory, request.workspaceRoot);
      const settings = await readSettings(env);
      const executable = resolveMuseExecutableEntry(env, settings, request.executablePath);
      if (!executable) {
        throw new MuseExecStartupError(
          "executableNotFound",
          `Muse Code CLI executable "${settings.executablePath?.trim() || "muse"}" was not found. Install the CLI or set an absolute executable path in MOS Model Settings.`,
        );
      }
      // 会话映射（R2；验证轮修正 A resume 门控）：映射的 canonical 物理根与当前
      // 请求根的实时物理解析结果一致（canResumeMuseSessionMapping——每次续接都
      // 重新 realpath，无词法同串捷径，symlink retarget 后不再续接）才续接
      // documented `--session-id`；不一致 = 当前根内开新会话（fail-closed 连续性，
      // 绝不跨 workspace 续接）。
      const sessionMap = await sessionStore.read().catch(() => ({} as Record<string, never>));
      const existingMapping = lookupMuseSessionMapping(sessionMap, request.sessionId);
      const resumeRootMatches = existingMapping
        ? await canResumeMuseSessionMapping(existingMapping, request.workspaceRoot)
        : false;
      return runMuseExecChild(executable, request, settings, handlers, env, {
        existingMuseSessionId: resumeRootMatches ? existingMapping?.museSessionId : undefined,
        sessionWorkspaceMismatch: existingMapping !== undefined && !resumeRootMatches,
        sessionStore,
        onSessionMapWriteError: deps.onSessionMapWriteError,
      });
    },
  };
}

async function runMuseExecChild(
  executable: string,
  request: MuseExecRequest,
  settings: MuseCodeBackendSettings,
  handlers: MuseExecHandlers,
  parentEnv: NodeJS.ProcessEnv,
  continuity: {
    existingMuseSessionId?: string;
    /** true = 既有映射因 workspace 根不一致而未续接（rev. 3；结果如实回传）。 */
    sessionWorkspaceMismatch?: boolean;
    sessionStore: MuseSessionStore;
    onSessionMapWriteError?: (error: unknown) => void;
  },
): Promise<MuseExecRunResult> {
  const timeoutMs =
    request.timeoutMs && request.timeoutMs > 0
      ? request.timeoutMs
      : settings.timeoutMs && settings.timeoutMs > 0
        ? settings.timeoutMs
        : DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS;
  const maxModelSteps = request.maxModelSteps ?? settings.maxModelSteps;
  const approvalPosture: MuseExecApprovalPosture =
    settings.approvalPosture === "unattended-sandboxed" ? "unattended-sandboxed" : "fail-closed";
  const promptDir = join(tmpdir(), `mos-muse-${crypto.randomUUID().slice(0, 8)}`);
  const promptFile = join(promptDir, "prompt.txt");
  let child: ReturnType<typeof spawn> | undefined;
  let timedOut = false;
  let cancelled = false;
  let unknownEventCount = 0;
  let stderr = "";
  let toolEventSeq = 0;
  let approvalRequestsObserved = 0;
  let userQuestionsObserved = 0;
  let capturedMuseSessionId: string | undefined;
  const activeToolIdsByName = new Map<string, string>();
  const pending = new Set<Promise<void>>();

  /** muse 工具事件缺 id 时合成稳定关联 id（同工具名的 started→completed 配对）。 */
  const synthesizeToolCallIds = (event: MuseExecStreamEvent): MuseExecStreamEvent => {
    if (event.kind !== "tool_activity") return event;
    if (event.toolCallId && event.toolCallId.length > 0) return event;
    toolEventSeq += 1;
    if (event.status === "started") {
      const id = `muse:${event.toolName}:${toolEventSeq}`;
      activeToolIdsByName.set(event.toolName, id);
      return { ...event, toolCallId: id };
    }
    const activeId = activeToolIdsByName.get(event.toolName);
    activeToolIdsByName.delete(event.toolName);
    return { ...event, toolCallId: activeId ?? `muse:${event.toolName}:${toolEventSeq}` };
  };

  const combinedSignal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const onCombinedAbort = () => {
    if (request.signal.aborted) {
      cancelled = true;
    } else {
      timedOut = true;
    }
    terminateChildTree(child);
  };
  combinedSignal.addEventListener("abort", onCombinedAbort, { once: true });
  if (combinedSignal.aborted) {
    // 进入时已取消/超时：不再 spawn，直接返回取消事实，由调用方裁决。
    combinedSignal.removeEventListener("abort", onCombinedAbort);
    return {
      cancelled: request.signal.aborted,
      exitCode: null,
      stderrTail: "",
      timedOut: !request.signal.aborted,
      unknownEventCount: 0,
      surface: "muse-exec",
      ...(continuity.existingMuseSessionId ? { museSessionId: continuity.existingMuseSessionId } : {}),
      resumedMuseSession: false,
      ...(continuity.sessionWorkspaceMismatch ? { sessionWorkspaceMismatch: true } : {}),
      approvalRequestsObserved: 0,
      userQuestionsObserved: 0,
      approvalPosture,
    };
  }

  try {
    await mkdir(promptDir, { recursive: true });
    await writeFile(promptFile, request.prompt, "utf8");
    const args = [
      "exec",
      "--json",
      // workspace 边界（R4；rev. 3 修正）：documented `--workspace <path>`（Meta 当前
      // 配置文档列为 interactive/headless 通用的 common flag）= MOS workspace 根，
      // 把 CLI 侧边界钉到同一策略根（MOS 侧词法+物理收敛校验仍是第一道闸）。
      "--workspace",
      request.workspaceRoot,
      "--prompt-file",
      promptFile,
      ...(maxModelSteps !== undefined ? ["--max-model-steps", String(maxModelSteps)] : []),
      // 会话续接（R2）：documented `--session-id <uuid>`（dev.meta.ai/docs/muse-code/extending
      // "Headless and CI"：headless runs are sessions; continue with the session id）。
      // 仅在映射根与当前根一致时传入（rev. 3 resume 门控）。
      ...(continuity.existingMuseSessionId
        ? ["--session-id", continuity.existingMuseSessionId]
        : []),
      // 审批姿态（R3）：unattended-sandboxed = documented `--disable-approval`
      // （skip approval prompts, keep the sandbox on）。fail-closed 不传任何审批旗标。
      // `--yolo`（关审批+关 sandbox）永不被构造（ACR-0002 红线）。
      ...(approvalPosture === "unattended-sandboxed" ? ["--disable-approval"] : []),
    ];
    try {
      child = spawn(executable, args, {
        cwd: request.workingDirectory,
        detached: process.platform !== "win32",
        // 环境隔离（R5）：允许清单构造；muse CLI 的登录态在其自身配置目录
        // （USERPROFILE/APPDATA/HOME 已覆盖），不需要 MOS 传递任何凭据。
        env: buildMuseChildEnv(parentEnv),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new MuseExecStartupError(
        "spawnFailed",
        `Failed to launch Muse Code CLI at ${executable}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (child.pid === undefined || !child.stdout || !child.stderr) {
      // ENOENT 等异步 spawn 错误：必须先挂 error 监听再抛，否则事件无监听升级为 uncaught。
      child.once("error", () => undefined);
      throw new MuseExecStartupError(
        "spawnFailed",
        `Failed to launch Muse Code CLI at ${executable} (process did not start)`,
      );
    }

    const dispatchLine = async (line: string): Promise<void> => {
      if (combinedSignal.aborted) return;
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        unknownEventCount += 1;
        return;
      }
      const parsed = parseMuseExecJsonlLine(line);
      if (parsed.status === "empty") return;
      // 信封级候选 session id 捕获（R2）：任意行（含未知类型行——如 session_started
      // 申报）都先捕获再分流；首个非空值生效（后续同值幂等）。
      if ("museSessionId" in parsed && parsed.museSessionId && !capturedMuseSessionId) {
        capturedMuseSessionId = parsed.museSessionId;
      }
      if (parsed.status === "unknown" || parsed.status === "invalid") {
        unknownEventCount += 1;
        return;
      }
      if (parsed.event.kind === "approval_required") approvalRequestsObserved += 1;
      if (parsed.event.kind === "user_question") userQuestionsObserved += 1;
      await handlers.onEvent(synthesizeToolCallIds(parsed.event));
    };

    let dispatchFailure: unknown;
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      const handling = dispatchLine(line).catch((error: unknown) => {
        // handler 抛错（含取消）：终止子进程并让错误冒泡为本 run 的失败。
        terminateChildTree(child);
        dispatchFailure ??= error;
      });
      pending.add(handling);
      void handling.finally(() => pending.delete(handling));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = trimStderr(stderr + chunk.toString("utf8"));
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.once("error", (error: Error) => {
        reject(
          new MuseExecStartupError(
            "spawnFailed",
            `Muse Code CLI at ${executable} failed to start: ${error.message}`,
            { cause: error },
          ),
        );
      });
      child!.once("close", (code) => resolve(code));
    });
    reader.close();
    // 子进程退出后，先前派发的事件仍在飞；全部收口再返回。
    while (pending.size > 0) await Promise.allSettled(pending);
    if (dispatchFailure !== undefined) throw dispatchFailure;
    // 会话映射回写（R2）：捕获到 session id 即持久化（原子写；失败降级 + 告警，
    // 绝不阻断 turn 收口）。exec 面的 id 申报依赖 JSONL 信封字段（在机验证 §4）。
    if (capturedMuseSessionId) {
      try {
        const map = await continuity.sessionStore.read();
        // canonical 物理根（验证轮修正 A）：记录时 realpath 解析；不可解析 = 空串
        // → 下轮拒绝续接（fail-closed）。
        const canonicalWorkspaceRoot =
          (await resolveMuseWorkspaceRootPhysical(request.workspaceRoot)) ?? "";
        await continuity.sessionStore.write(
          recordMuseSessionMapping(map, request.sessionId, {
            museSessionId: capturedMuseSessionId,
            surface: "muse-exec",
            workspaceRoot: request.workspaceRoot,
            canonicalWorkspaceRoot,
          }),
        );
      } catch (error) {
        continuity.onSessionMapWriteError?.(error);
      }
    }
    // 观测/恢复（R2）：本轮 JSONL 申报的 id 优先；CLI 未再申报时回退到本轮
    // 续接传入的 id（我们持有的事实——由 argv 传给 CLI 并驱动了本轮 resume）。
    const reportedMuseSessionId = capturedMuseSessionId ?? continuity.existingMuseSessionId;
    return {
      cancelled,
      exitCode,
      stderrTail: stderr,
      timedOut,
      unknownEventCount,
      surface: "muse-exec",
      ...(reportedMuseSessionId ? { museSessionId: reportedMuseSessionId } : {}),
      resumedMuseSession: continuity.existingMuseSessionId !== undefined,
      ...(continuity.sessionWorkspaceMismatch ? { sessionWorkspaceMismatch: true } : {}),
      approvalRequestsObserved,
      userQuestionsObserved,
      approvalPosture,
    };
  } finally {
    combinedSignal.removeEventListener("abort", onCombinedAbort);
    terminateChildTree(child);
    while (pending.size > 0) await Promise.allSettled(pending);
    await rm(promptDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

function terminateChildTree(child: ReturnType<typeof spawn> | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (typeof pid !== "number") {
    // 从未拿到 pid（spawn ENOENT 等）：没有可终止的进程；再 kill 只会二次抛错。
    return;
  }
  if (process.platform === "win32") {
    // taskkill 是可执行文件直调（无 shell）；/T 覆盖子树，/F 强制。
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child?.kill());
    return;
  }
  try {
    // detached spawn 建立了独立进程组；kill(-pid) 覆盖整组后代。
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceTimer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, TREE_FORCE_AFTER_MS);
  forceTimer.unref?.();
}

function trimStderr(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= STDERR_LIMIT) return value;
  return value.slice(-STDERR_LIMIT);
}
