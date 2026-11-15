import { SessionEventType, TurnMachineImpl, createMessageId, createPartId, createToolCallId, traceContextToLogContext } from "../deps.js";
// 委托 Muse Code 本地执行后端的 turn 执行器（Issue #24 / ACR-0002）。
//
// 边界（与普通模型轮的根本区别）：
// - 不创建 provider Model、不请求 Provider Registry、不运行本进程的工具环：
//   工具执行发生在 muse CLI 自己的会话里，本模块只把它的 JSONL 事件投影成
//   标准 SessionEvent（assistant 文本流 + 工具活动行），保证 UI/持久化/冷恢复
//   与普通轮共用同一投影。
// - 不产生双工具环：本轮绝不调用 executor/scheduleTools；muse 的工具活动只作为
//   只读遥测投影（ToolCallStarted/ToolCallResult），不经 MOS 权限系统重放。
// - 取消：turnAbortSignal 交给端口（端口负责终止整个进程树）；本模块在事件间隙
//   检查信号，取消错误沿普通轮的 catch 收口为 TurnComplete(cancelled)。
// - 归因诚实：assistant 消息标注 muse-code/muse-exec（实际执行者），绝不冒用
//   会话常驻 provider Model 的名义。
import type { MessageId, SessionEvent, TraceContext, TurnId } from "../deps.js";
import type { ModelSelection } from "../deps.js";
import { emptyTokenUsageInfo, throwIfTurnAborted } from "../helpers/index.js";
import { isTurnCancellationError } from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { createModelId, createModelProviderId } from "@zcode/contracts";
import { isMuseDelegatedModelSelection } from "@zcode/shared";
import { buildProjectionAnchor } from "./projection-anchor.js";
import { persistTextBlockParts } from "./message-persistence.js";
import { emitModelStreamingEvent } from "./model-streaming-event.js";

/** delegated 后端缺失时的稳定错误 code（capability 门控漏放时的 fail-closed 兜底）。 */
export const MUSE_EXEC_TURN_UNAVAILABLE_CODE = "ZCODE_MUSE_EXEC_UNAVAILABLE";
export const MUSE_EXEC_TURN_TIMEOUT_CODE = "ZCODE_MUSE_EXEC_TIMEOUT";
export const MUSE_EXEC_TURN_EXIT_CODE = "ZCODE_MUSE_EXEC_EXIT";

/**
 * 委托轮的精确模型钉住（MC-D 验证轮，TL correction round 2026-11-15）：本轮有效
 * 选型命中 Muse delegated 模型家族（shared isMuseDelegatedModelSelection——用户
 * 提交的选型，绝不虚构/改写 id）时，把该 modelId 钉给执行端口；普通选型/缺选 =
 * 不钉（CLI 自身已认证配置；显式信封字段路径的既有行为不变）。
 */
export function museDelegatedModelPinOf(
  selection: ModelSelection | undefined | null,
): string | undefined {
  if (!selection || !isMuseDelegatedModelSelection(selection)) return undefined;
  return selection.modelId;
}

/** 诚实归因：本地 Muse Code CLI，而非任何 Registry provider。 */
const DELEGATED_MUSE_PROVIDER_ID = createModelProviderId("muse-code");
const DELEGATED_MUSE_MODEL_ID = createModelId("muse-exec");

export interface DelegatedMuseTurnParams {
  /** 展开后的 runtime 提示（与普通轮的 executeTurn input 同源）。 */
  input: string;
  userMessageId: MessageId;
  turnId: TurnId;
  inputId?: string;
  /**
   * 本轮准入时冻结的有效选型（MC-D 验证轮）：命中 Muse delegated 模型家族时
   * 其 modelId 钉给执行端口（museDelegatedModelPinOf；普通选型不钉）。与
   * bootstrap 侧选型驱动路由同一判定（shared isMuseDelegatedModelSelection）。
   */
  modelSelection?: ModelSelection;
  turnMachine: TurnMachineImpl;
  turnAbortSignal: AbortSignal;
  turnTraceContext: TraceContext;
  events: SessionEvent[];
  turnStartedAtMs: number;
}

export interface DelegatedMuseTurnResult {
  turnMachine: TurnMachineImpl;
  response: string;
  toolCallCount: number;
  /** 端口申报的 turn 级 token 用量（缺省 = 未申报；PR #27 评审 R6）。 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** 审批请求/用户提问观测计数（fail-closed 拒绝同样计数；可见性优先）。 */
  approvalRequestsObserved: number;
  userQuestionsObserved: number;
  /** 本轮实际执行面（端口选择；归因如实）。 */
  surface: "muse-exec" | "session-protocol";
  museSessionId?: string;
  resumedMuseSession: boolean;
}

export async function runDelegatedMuseTurn(
  this: AgentRuntimeInternal,
  params: DelegatedMuseTurnParams,
): Promise<DelegatedMuseTurnResult> {
  const port = this.museExecutionPort;
  if (!port) {
    // 正常路径下 v4 admission 已按 capability 拒绝；到这里说明装配缺口，fail closed。
    throw Object.assign(
      new Error("Muse Code execution backend is not wired into this runtime"),
      { code: MUSE_EXEC_TURN_UNAVAILABLE_CODE },
    );
  }
  const trace = params.turnTraceContext;
  const assistantMessageId = createMessageId();
  const assistantCreatedAt = Date.now();

  await persistDelegatedMuseAssistantMessage.call(this, {
    created: assistantCreatedAt,
    messageID: assistantMessageId,
    parentID: params.userMessageId,
    traceContext: trace,
  });
  await this.persistPart(
    {
      id: createPartId(),
      sessionID: this.sessionId,
      messageID: assistantMessageId,
      type: "step-start",
    },
    trace,
  );

  let textRowOpen = false;
  let responseText = "";
  let streamError: { message: string; code?: string } | undefined;
  const startedToolCallIds = new Set<string>();
  // 审批/提问可见性（PR #27 评审 R3）：外部 agent 的审批请求与用户提问不是工具遥测，
  // 但 headless 轮里必须可见——投影为专用活动行，绝不代答/代批。
  let approvalRequestsObserved = 0;
  let userQuestionsObserved = 0;
  let observedApprovalToolNames: string[] = [];
  const emitExternalNoticeRow = async (
    trace: typeof params.turnTraceContext,
    toolCallId: string,
    toolName: string,
    summary: string,
  ): Promise<void> => {
    await this.appendEvent(
      this.createEvent(
        SessionEventType.ToolCallStarted,
        { startedAt: new Date(), toolCallId, toolName },
        trace,
      ),
      trace,
    );
    await this.appendEvent(
      this.createEvent(
        SessionEventType.ToolCallResult,
        {
          duration: 0,
          result: { content: summary, success: false, truncated: true },
          toolCallId,
        },
        trace,
      ),
      trace,
    );
  };
  // 与普通轮同一状态机纪律：进入流式前先 startModelRequest（归因标签如实标注委托执行源）。
  let turnMachine = new TurnMachineImpl(
    params.turnMachine.startModelRequest("muse-code/muse-exec", []),
  );

  const closeTextRow = async (): Promise<void> => {
    if (!textRowOpen) return;
    textRowOpen = false;
    await emitModelStreamingEvent.call(
      this,
      { assistantMessageId, delta: "", done: false, kind: "text_end" },
      trace,
      params.events,
    );
  };

  await emitModelStreamingEvent.call(
    this,
    { assistantMessageId, delta: "", done: false, kind: "start" },
    trace,
    params.events,
  );

  let runResult;
  // 精确模型钉住（MC-D 验证轮）：有效选型命中家族时把选中的 modelId 交给端口
  // （用户提交的选型，绝不虚构）；端口按执行面用官方机制选中并在结果里如实回报
  // requested/effective（不可用时可见失败，绝不静默换模型）。
  const pinModelId = museDelegatedModelPinOf(params.modelSelection);
  try {
    runResult = await port.runMuseExec(
      {
        prompt: params.input,
        signal: params.turnAbortSignal,
        sessionId: this.sessionId,
        workingDirectory: this.workingDirectory,
        workspaceRoot: this.workspaceRoot,
        ...(pinModelId ? { modelId: pinModelId } : {}),
      },
      {
        onEvent: async (event) => {
          // 取消优先：端口会终止进程树；这里保证在途事件不再投影。
          throwIfTurnAborted(params.turnAbortSignal);
          switch (event.kind) {
            case "text_delta": {
              if (!textRowOpen) {
                textRowOpen = true;
                await emitModelStreamingEvent.call(
                  this,
                  { assistantMessageId, delta: "", done: false, kind: "text_start" },
                  trace,
                  params.events,
                );
              }
              responseText += event.text;
              await emitModelStreamingEvent.call(
                this,
                { assistantMessageId, delta: event.text, done: false, kind: "text_delta" },
                trace,
                params.events,
              );
              return;
            }
            case "text_end": {
              await closeTextRow();
              return;
            }
            case "tool_activity": {
              const toolCallId = createToolCallId(event.toolCallId);
              if (!startedToolCallIds.has(event.toolCallId)) {
                startedToolCallIds.add(event.toolCallId);
                await this.appendEvent(
                  this.createEvent(
                    SessionEventType.ToolCallStarted,
                    {
                      // 外部 agent 的工具活动：不声明 readOnly（无法判定），sideEffectScope 缺省。
                      startedAt: new Date(event.startedAt ?? Date.now()),
                      toolCallId,
                      toolName: event.toolName,
                    },
                    trace,
                  ),
                  trace,
                );
              }
              if (event.status !== "started") {
                await this.appendEvent(
                  this.createEvent(
                    SessionEventType.ToolCallResult,
                    {
                      duration: event.durationMs ?? 0,
                      result: {
                        content: event.summary ?? "",
                        success: event.status === "completed",
                        truncated: true,
                      },
                      toolCallId,
                    },
                    trace,
                  ),
                  trace,
                );
              }
              return;
            }
            case "error": {
              streamError = { code: event.code, message: event.message };
              return;
            }
            case "approval_required": {
              approvalRequestsObserved += 1;
              if (event.toolName) observedApprovalToolNames.push(event.toolName);
              await emitExternalNoticeRow.call(
                this,
                trace,
                createToolCallId(`muse:approval:${approvalRequestsObserved}`),
                event.toolName ? `muse-approval:${event.toolName}` : "muse-approval",
                `Muse agent requested approval${event.summary ? `: ${event.summary}` : ""} — not approved in delegated mode (unattended posture); adjust the approval posture in Model Settings or continue in the CLI`,
              );
              return;
            }
            case "user_question": {
              userQuestionsObserved += 1;
              await emitExternalNoticeRow.call(
                this,
                trace,
                createToolCallId(`muse:question:${userQuestionsObserved}`),
                "muse-question",
                `Muse agent asked a question (unanswered in delegated mode): ${event.summary}`,
              );
              return;
            }
          }
        },
      },
    );
  } catch (error) {
    await settleDelegatedMuseStream.call(this, {
      assistantCreatedAt,
      assistantMessageId,
      closeTextRow,
      error,
      responseText,
      trace,
      turnAbortSignal: params.turnAbortSignal,
      userMessageId: params.userMessageId,
    });
    throw error;
  }

  try {
    throwIfTurnAborted(params.turnAbortSignal);
    // 审批/提问计数对账（R3）：端口申报数与 core 事件投影数观测同一流，取大值
    // ——绝不低报（两侧实现差异/计数口径漂移只影响上限，不影响事实）。
    const observedApprovalRequests = Math.max(
      approvalRequestsObserved,
      runResult.approvalRequestsObserved,
    );
    const observedUserQuestions = Math.max(
      userQuestionsObserved,
      runResult.userQuestionsObserved,
    );
    if (streamError) {
      throw new Error(
        `Muse Code execution failed: ${trimForError(streamError.message)}${
        observedApprovalRequests > 0
          ? ` (${observedApprovalRequests} approval request(s) were observed; the unattended posture did not approve them — see Settings → Meta Muse Code)`
          : ""
      }`,
      );
    }
    if (runResult.timedOut) {
      throw Object.assign(new Error("Muse Code execution timed out"), {
        code: MUSE_EXEC_TURN_TIMEOUT_CODE,
      });
    }
    if (runResult.exitCode !== 0) {
      throw Object.assign(
        new Error(
          `Muse Code CLI exited with code ${runResult.exitCode ?? "unknown"}${runResult.stderrTail ? `: ${trimForError(runResult.stderrTail)}` : ""}${
            observedApprovalRequests > 0
              ? ` — ${observedApprovalRequests} approval request(s) observed; the unattended posture did not approve them (see Settings → Meta Muse Code)`
              : ""
          }`,
        ),
        { code: MUSE_EXEC_TURN_EXIT_CODE },
      );
    }
    await closeTextRow();
    await emitModelStreamingEvent.call(
      this,
      { assistantMessageId, delta: "", done: true, kind: "finish" },
      trace,
      params.events,
    );
    // 用量诚实（PR #27 评审 R6）：订阅计量的 delegated 轮没有可记录的货币成本——
    // cost 记 null（未申报），绝不记 0（会被下游误读为免费/零消耗）。token 由端口
    // 申报时如实映射（MSP 面 turn/completed）；exec 面未申报时 metadata 明确标注。
    const reportedUsage = runResult.usage;
    const delegatedTokens = reportedUsage
      ? {
          input: reportedUsage.inputTokens,
          output: reportedUsage.outputTokens,
          reasoning: reportedUsage.reasoningTokens,
          cache: {
            read: reportedUsage.cacheReadTokens ?? reportedUsage.cachedTokens,
            write: reportedUsage.cacheWriteTokens ?? 0,
          },
        }
      : emptyTokenUsageInfo();
    const delegatedUsageMetadata = {
      museExecution: {
        surface: runResult.surface,
        usageReporting: reportedUsage ? ("reported" as const) : ("unreported" as const),
        ...(runResult.museSessionId ? { museSessionId: runResult.museSessionId } : {}),
        resumedMuseSession: runResult.resumedMuseSession,
        ...(runResult.sessionWorkspaceMismatch
          ? { sessionWorkspaceMismatch: true as const }
          : {}),
        approvalRequestsObserved: observedApprovalRequests,
        userQuestionsObserved: observedUserQuestions,
        ...(runResult.subscriptionUsage
          ? { subscriptionUsage: runResult.subscriptionUsage }
          : {}),
        // 模型钉住归因（MC-D 验证轮）：requested = 本轮选型钉住的 id；effective =
        // 执行面申报的实际生效模型（MSP 回读/setModel 准入；exec 面缺省 = 未申报，
        // 绝不虚构）。Contributor 模式由用户 CLI 自治——MOS 绝不传
        // --contributor-mode（SDK 无 contributor 成员），策略事实如实入证据。
        ...(runResult.requestedModelId
          ? { requestedModelId: runResult.requestedModelId }
          : {}),
        ...(runResult.effectiveModelId
          ? { effectiveModelId: runResult.effectiveModelId }
          : {}),
        ...(runResult.modelPinMechanism
          ? { modelPinMechanism: runResult.modelPinMechanism }
          : {}),
        contributorModePolicy: "cli-default" as const,
      },
    };
    await persistTextBlockParts(
      this,
      {
        messageId: assistantMessageId,
        text: responseText,
        textBlocks: undefined,
        time: { end: Date.now(), start: assistantCreatedAt },
      },
      trace,
    );
    await this.persistPart(
      {
        id: createPartId(),
        sessionID: this.sessionId,
        messageID: assistantMessageId,
        type: "step-finish",
        reason: "muse_turn_complete",
        cost: null,
        tokens: delegatedTokens,
      },
      trace,
    );
    await persistDelegatedMuseAssistantMessage.call(this, {
      created: assistantCreatedAt,
      messageID: assistantMessageId,
      parentID: params.userMessageId,
      traceContext: trace,
      metadata: delegatedUsageMetadata,
      update: {
        completed: Date.now(),
        finish: "muse_turn_complete",
        tokens: delegatedTokens,
      },
    });
    let finalTurnMachine = new TurnMachineImpl(turnMachine.receiveModelResponse(responseText));
    finalTurnMachine = new TurnMachineImpl(finalTurnMachine.aggregateResults());
    this.logger?.info("Muse delegated turn completed", {
      ...traceContextToLogContext(trace),
      durationMs: Date.now() - params.turnStartedAtMs,
      event: "muse_delegated_turn.completed",
      exitCode: runResult.exitCode,
      module: "core.runtime",
      status: "completed",
      surface: runResult.surface,
      ...(runResult.museSessionId ? { museSessionId: runResult.museSessionId } : {}),
      resumedMuseSession: runResult.resumedMuseSession,
      ...(runResult.sessionWorkspaceMismatch
        ? { sessionWorkspaceMismatch: true }
        : {}),
      approvalRequestsObserved: observedApprovalRequests,
      userQuestionsObserved: observedUserQuestions,
      usageReporting: reportedUsage ? "reported" : "unreported",
      ...(runResult.subscriptionUsage
        ? { subscriptionWindowUsedPercent: runResult.subscriptionUsage.windowUsedPercent }
        : {}),
      // 模型钉住归因（MC-D 验证轮；在机 §4 步骤 13 的核对字段）。
      ...(runResult.requestedModelId
        ? { requestedModelId: runResult.requestedModelId }
        : {}),
      ...(runResult.effectiveModelId
        ? { effectiveModelId: runResult.effectiveModelId }
        : {}),
      ...(runResult.modelPinMechanism
        ? { modelPinMechanism: runResult.modelPinMechanism }
        : {}),
      toolCallCount: startedToolCallIds.size,
      unknownEventCount: runResult.unknownEventCount,
    });
    return {
      response: responseText,
      toolCallCount: startedToolCallIds.size,
      turnMachine: finalTurnMachine,
      ...(reportedUsage ? { usage: reportedUsage } : {}),
      approvalRequestsObserved: observedApprovalRequests,
      userQuestionsObserved: observedUserQuestions,
      surface: runResult.surface,
      ...(runResult.museSessionId ? { museSessionId: runResult.museSessionId } : {}),
      resumedMuseSession: runResult.resumedMuseSession,
    };
  } catch (error) {
    await settleDelegatedMuseStream.call(this, {
      assistantCreatedAt,
      assistantMessageId,
      closeTextRow,
      error,
      responseText,
      trace,
      turnAbortSignal: params.turnAbortSignal,
      userMessageId: params.userMessageId,
    });
    throw error;
  }
}

/**
 * 委托轮的失败/取消收口：镜像模型轮取消路径（persistCancelledStreamSnapshot 语义）——
 * flush 已到达的文本、收口 assistant 消息（取消带 turnResult: "cancelled" 供冷恢复区分），
 * 不吞错、不补写终态事件（TurnError/TurnComplete 由 executeTurnCommand 的 catch 统一写）。
 */
async function settleDelegatedMuseStream(
  this: AgentRuntimeInternal,
  input: {
    assistantCreatedAt: number;
    assistantMessageId: MessageId;
    closeTextRow(): Promise<void>;
    error: unknown;
    responseText: string;
    trace: TraceContext;
    turnAbortSignal: AbortSignal;
    userMessageId: MessageId;
  },
): Promise<void> {
  const trace = input.trace;
  try {
    await input.closeTextRow();
  } catch {
    // 收口失败不能覆盖原始错误。
  }
  try {
    await persistTextBlockParts(
      this,
      {
        messageId: input.assistantMessageId,
        text: input.responseText,
        textBlocks: undefined,
        time: { end: Date.now(), start: input.assistantCreatedAt },
      },
      trace,
    );
    const cancelled = isTurnCancellationError(input.error, input.turnAbortSignal);
    await persistDelegatedMuseAssistantMessage.call(this, {
      created: input.assistantCreatedAt,
      messageID: input.assistantMessageId,
      parentID: input.userMessageId,
      traceContext: trace,
      update: {
        completed: Date.now(),
        error: {
          name: input.error instanceof Error ? input.error.name : "UnknownError",
          data: {
            message:
              input.error instanceof Error ? input.error.message : String(input.error),
            ...(cancelled ? { turnResult: "cancelled" as const } : {}),
          },
        },
        finish: cancelled ? "muse_turn_cancelled" : "muse_turn_error",
      },
    });
  } catch (persistenceError) {
    this.logger?.warn("Muse delegated turn settlement persistence failed", {
      ...traceContextToLogContext(trace),
      errorMessage:
        persistenceError instanceof Error
          ? persistenceError.message
          : String(persistenceError),
      event: "muse_delegated_turn.settlement_failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

function trimForError(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return flattened.length > 400 ? `${flattened.slice(0, 400)}…` : flattened;
}

/**
 * 与 persistAssistantMessage 同构，但归因固定为 muse-code/muse-exec：
 * 委托轮不能冒用会话常驻 Selection（那会把 CLI 输出错误标记成某个 provider 模型），
 * 也不允许把 muse-code 塞回 Registry（ACR-0002）。
 */
async function persistDelegatedMuseAssistantMessage(
  this: AgentRuntimeInternal,
  input: {
    created: number;
    messageID: MessageId;
    parentID: MessageId;
    traceContext: TraceContext;
    /** 委托执行归因/用量申报标记（PR #27 评审 R6；metadata 字段即为此设计的自由栏）。 */
    metadata?: Record<string, unknown>;
    update?: {
      completed?: number;
      error?: { name: string; data?: Record<string, unknown> };
      finish?: string;
      tokens?: ReturnType<typeof emptyTokenUsageInfo>;
    };
  },
): Promise<void> {
  this.latestConversationMessageId = input.messageID;
  this.latestAssistantMessageId = input.messageID;
  if (input.traceContext.turnId) {
    this.latestAssistantTurnId = input.traceContext.turnId;
  }
  if (!this.sessionStore) return;
  await this.persistMessage(
    {
      id: input.messageID,
      sessionID: this.sessionId,
      role: "assistant",
      time: {
        created: input.created,
        completed: input.update?.completed,
      },
      error: input.update?.error,
      parentID: input.parentID,
      modelId: DELEGATED_MUSE_MODEL_ID,
      providerId: DELEGATED_MUSE_PROVIDER_ID,
      mode: this.config.mode ?? "build",
      planEnabled: this.getPlanEnabled(),
      agent: this.config.agentName ?? "zcode-agent",
      path: {
        cwd: this.workingDirectory,
        root: this.workspaceRoot,
      },
      cost: null,
      tokens: input.update?.tokens ?? emptyTokenUsageInfo(),
      finish: input.update?.finish,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      semantics: {
        origin: "agent_runtime",
        kind: "assistant_response",
        uiVisibility: "visible",
        providerVisibility: "visible",
        transcriptVisibility: "visible",
      },
      anchor: buildProjectionAnchor(input.traceContext),
    },
    input.traceContext,
  );
}
