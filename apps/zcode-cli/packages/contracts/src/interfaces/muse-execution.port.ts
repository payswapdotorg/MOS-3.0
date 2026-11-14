// ============================================================
// MuseExecution Port - delegated Muse Code CLI execution boundary
// ============================================================
// Issue #24 / ACR-0002：Muse Code 是本地 agent runtime 执行后端。
// Core 只通过该端口消费已归一化的执行事件，绝不感知进程/CLI 细节；
// 进程生命周期（spawn/kill/超时/stderr 截断）由 bootstrap 实现拥有。
// 端口事件是 MOS 内部模型：`muse exec --json` 的原始 JSONL 映射由
// bootstrap 的 mapping 层完成（见 bootstrap src/muse-code/），映射表
// 版本化，未知事件类型必须计数而不是猜测。

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
  | { kind: "error"; message: string; code?: string };

export interface MuseExecRequest {
  /** 展开后的完整任务提示（与普通轮的 runtime input 同源）。 */
  prompt: string;
  /** 会话工作目录：CLI 的 cwd，也是文件系统约束边界。 */
  workingDirectory: string;
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

export interface MuseExecRunResult {
  /** null = 被信号杀死且拿不到退出码。 */
  exitCode: number | null;
  /** 截断后的 stderr 尾部（诊断用；不进入模型/会话事件正文）。 */
  stderrTail: string;
  /** 无法映射的 JSONL 行数（forward-compat 观测，不猜测语义）。 */
  unknownEventCount: number;
  /** 超时触发（进程树已被终止）。 */
  timedOut: boolean;
  /** 请求信号触发（进程树已被终止）。 */
  cancelled: boolean;
}

export interface MuseExecutionPort {
  /**
   * 执行一次 `muse exec`。resolve = 进程已退出且事件已全部派发；
   * reject = 启动失败（找不到可执行入口、spawn 错误）。
   * 执行失败语义（非零退出、超时、取消）经 result 表达，由调用方裁决。
   */
  runMuseExec(request: MuseExecRequest, handlers: MuseExecHandlers): Promise<MuseExecRunResult>;
}
