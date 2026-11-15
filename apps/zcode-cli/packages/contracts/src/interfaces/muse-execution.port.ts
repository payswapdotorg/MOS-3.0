// ============================================================
// MuseExecution Port - delegated Muse Code CLI execution boundary
// ============================================================
// Issue #24 / ACR-0002（PR #27 评审修订）：Muse Code 是本地 agent runtime 执行后端。
// Core 只通过该端口消费已归一化的执行事件，绝不感知进程/CLI 细节；
// 进程生命周期（spawn/kill/超时/stderr 截断）由 bootstrap 实现拥有。
// 端口事件是 MOS 内部模型；原始事件面（`muse exec --json` JSONL 或
// Muse Session Protocol）的映射由 bootstrap 的 mapping 层完成，映射表
// 版本化，未知事件类型必须计数而不是猜测。
//
// 执行面（PR #27 评审 R1）：实现可能在两个官方界面之间选择——
// - "muse-exec"：documented `muse exec --json`（所有 CLI 版本可用）；
// - "session-protocol"：documented `muse serve` + @muse-code/sdk（MSP），
//   提供会话恢复、审批回调与官方 workspaceRoot 边界。
// 实际使用的执行面由 result.surface 如实回传，core 据此归因。

/** delegated 轮实际使用的执行面（端口选择，core 只读归因）。 */
export type MuseExecutionSurface = "muse-exec" | "session-protocol";

export type MuseExecStreamEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "text_end" }
  | {
      kind: "tool_activity";
      /** MOS 侧合成的稳定 id（端口实现负责生成，例如 muse:<seq>）。 */
      toolCallId: string;
      toolName: string;
      status: "started" | "completed" | "error";
      /** 已截断的活动摘要（不含原始大块输出）。 */
      summary?: string;
      startedAt?: number;
      durationMs?: number;
    }
  /**
   * 外部 agent 请求工具审批（PR #27 评审 R3）。只读遥测：MOS 不重放/不代答
   * （fail-closed 姿态下端口侧拒绝，事件仍如实投影供用户可见）。
   */
  | { kind: "approval_required"; toolName?: string; summary?: string }
  /** 外部 agent 向用户提问（无人应答的 headless 轮里如实投影，不自动作答）。 */
  | { kind: "user_question"; summary: string }
  | { kind: "error"; message: string; code?: string };

/** 审批姿态（与 shared 的 MuseCodeApprovalPosture 同 vocabulary；本地声明避免 contracts→shared 依赖）。 */
export type MuseExecApprovalPosture = "fail-closed" | "unattended-sandboxed";

export interface MuseExecRequest {
  /** 展开后的完整任务提示（与普通轮的 runtime input 同源）。 */
  prompt: string;
  /**
   * MOS 会话 id：delegated 轮与 muse 会话的持久映射键（PR #27 评审 R2）。
   * 端口实现负责读取/写入映射（MSP 面 resumeSession；exec 面 documented
   * `--session-id` 续接），映射跨 MOS 重启存活。
   */
  sessionId: string;
  /** 会话工作目录：CLI 的 cwd。必须位于 workspaceRoot 内（端口 fail-closed 校验）。 */
  workingDirectory: string;
  /**
   * MOS workspace 根：策略边界（PR #27 评审 R4）。MSP 面作为官方
   * `session/start` 的 workspaceRoot/workspaceRoots 传入（policy-gated root）；
   * exec 面 cwd 边界由本根约束（containment 校验）。
   */
  workspaceRoot: string;
  /** 取消信号：abort 后端口必须终止整个进程树并结束 run。 */
  signal: AbortSignal;
  /** 总超时（毫秒）；0/缺省 = 实现默认。 */
  timeoutMs?: number;
  /** documented `--max-model-steps` 上限；缺省不传。 */
  maxModelSteps?: number;
  /** 显式可执行入口覆盖（Host 设置）；缺省 = 实现 PATH 解析。 */
  executablePath?: string;
}

export interface MuseExecHandlers {
  onEvent(event: MuseExecStreamEvent): Promise<void> | void;
}

/** 端口申报的 turn 级 token 用量（presence = reported；缺省 = 未申报，绝不等价于零消耗）。 */
export interface MuseTurnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * 订阅用量快照（MSP 面 `usage/read`；PR #27 评审 R6——订阅额度在被消耗，
 * 必须可见而不是记录为 0 成本）。百分比来自 provider 原值（可能 > 100）。
 */
export interface MuseSubscriptionUsageSnapshot {
  tier: string;
  windowUsedPercent: number;
  windowResetsAtMs: number;
  weeklyUsedPercent: number;
  weeklyResetsAtMs: number;
}

export interface MuseExecRunResult {
  /** null = 被信号杀死且拿不到退出码（MSP 面按 outcome 语义合成）。 */
  exitCode: number | null;
  /** 截断后的 stderr 尾部（诊断用；不进入模型/会话事件正文）。 */
  stderrTail: string;
  /** 无法映射的 JSONL 行数（forward-compat 观测，不猜测语义）。 */
  unknownEventCount: number;
  /** 超时触发（进程树已被终止）。 */
  timedOut: boolean;
  /** 请求信号触发（进程树已被终止）。 */
  cancelled: boolean;
  /** 本轮实际使用的执行面（PR #27 评审 R1；归因与日志如实记录）。 */
  surface: MuseExecutionSurface;
  /** 端口观测/恢复的 muse 会话 id（exec 面依赖 JSONL 申报，未申报 = 缺省）。 */
  museSessionId?: string;
  /** 本轮是否续接了既有 muse 会话（false = 新会话或连续性不可用）。 */
  resumedMuseSession: boolean;
  /**
   * true = 既有映射因 workspace 根与当前请求根不一致（词法 + realpath 别名解析）
   * 而未续接（评审 rev. 3）：连续性已在当前根内重置为新会话，绝不跨 workspace
   * 边界续接旧会话；core 据此归因/记录连续性重置。
   */
  sessionWorkspaceMismatch?: boolean;
  /** 观测到的审批请求数（fail-closed 拒绝同样计数）。 */
  approvalRequestsObserved: number;
  /** 观测到的用户提问数（headless 轮未作答）。 */
  userQuestionsObserved: number;
  /** turn 级 token 用量；缺省 = CLI 未申报（不等于零消耗）。 */
  usage?: MuseTurnTokenUsage;
  /** 订阅用量快照（MSP 面 best-effort；缺省 = 未观测）。 */
  subscriptionUsage?: MuseSubscriptionUsageSnapshot;
  /** 本轮生效的审批姿态（设置决定；core 用于失败信息与日志归因）。 */
  approvalPosture: MuseExecApprovalPosture;
}

export interface MuseExecutionPort {
  /**
   * 执行一次 delegated turn（exec 或 MSP 面）。resolve = 进程/会话已收口且事件已
   * 全部派发；reject = 启动失败（找不到可执行入口、spawn 错误、workspace 越界）。
   * 执行失败语义（非零退出、超时、取消）经 result 表达，由调用方裁决。
   */
  runMuseExec(request: MuseExecRequest, handlers: MuseExecHandlers): Promise<MuseExecRunResult>;
}
