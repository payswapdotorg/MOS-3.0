/**
 * Muse Code（本地 CLI）delegated execution backend 的 Model 适配器（ACR-0002）。
 *
 * 定位：把本机 `muse serve`（Muse Session Protocol）暴露成一个符合 ZCode
 * Model 契约的可执行模型。它 **不是** OpenAI 兼容推理端点——Muse Code 是
 * 完整的 agent，工具在 provider 侧执行并以 provider_tool_result 投影；
 * MOS 的工具环在本后端下不参与执行。
 *
 * 回合模型：每个 MOS 模型请求 = 一个全新 MSP session + 一个 Muse 回合
 * （无状态，见 muse-request-mapper.ts）；宿主连接进程级共享。
 */

import type {
  ApprovalDecisionInput,
  ApprovalFailure,
  MuseClient,
  Session,
  Turn,
  TurnOutcome,
} from "@muse-code/sdk";
import {
  ModelErrorCode,
  ModelProtocolError,
  type Logger,
  type Model,
  type ModelEvent,
  type ModelOptionSpecs,
  type ModelOptions,
  type ModelProperties,
  type ModelTextResult,
} from "@zcode/contracts";
import {
  isMuseSessionProtocolApi,
  type ModelConfig,
  type RegistryProviderConfig,
} from "@zcode/provider";
import { createModel, type ModelExecutionRequest, type ModelExecutor } from "../model.js";
import { isMuseHostDeath, MuseHostManager, type MuseClientFactory } from "./muse-host.js";
import {
  MuseTurnEventReducer,
  type MuseApprovalRequestParams,
  type MuseItemDeltaParams,
} from "./muse-event-mapper.js";
import { renderMuseTurnPrompt, toMuseReasoningEffort } from "./muse-request-mapper.js";
import {
  decideMuseApproval,
  MUSE_TOOL_APPROVAL_ENV_VAR,
  resolveMuseToolApprovalPolicy,
  type MuseToolApprovalPolicyName,
} from "./muse-approval-policy.js";

export interface MuseSessionModelAdapterOptions {
  /** MSP session 的 workspaceRoot：Muse 的文件/命令活动被限制在该工作区内。 */
  readonly workspaceRoot: string;
  readonly appVersion: string;
  /** 环境记录（沿用 create-app 传入的 env）；读取审批策略与 CLI 路径覆盖。 */
  readonly env?: Record<string, string | undefined>;
  readonly logger?: Logger;
  /** 显式 muse 可执行文件路径；缺省用 ZCODE_MUSE_CLI_PATH 或 PATH 发现。 */
  readonly museBin?: string;
  /** 契约测试注入点；生产缺省 MuseClient.spawn。 */
  readonly clientFactory?: MuseClientFactory;
}

export interface CreateMuseSessionModelOptions {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerConfig: RegistryProviderConfig;
  readonly modelConfig: ModelConfig;
  readonly displayName?: string;
  readonly options?: ModelOptions;
}

const CLIENT_INFO_NAME = "zcode";

export class MuseSessionModelAdapter {
  readonly #host: MuseHostManager;
  readonly #workspaceRoot: string;
  readonly #policy: MuseToolApprovalPolicyName;
  readonly #logger?: Logger;

  constructor(options: MuseSessionModelAdapterOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#logger = options.logger;
    this.#policy = resolveMuseToolApprovalPolicy(
      options.env?.[MUSE_TOOL_APPROVAL_ENV_VAR],
    );
    const museBin = options.museBin ?? options.env?.["ZCODE_MUSE_CLI_PATH"];
    this.#host = new MuseHostManager({
      clientInfo: { name: CLIENT_INFO_NAME, version: options.appVersion },
      ...(museBin ? { museBin } : {}),
      logger: options.logger,
      ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
    });
  }

  createModel(options: CreateMuseSessionModelOptions): Model {
    if (!isMuseSessionProtocolApi(options.providerConfig.api)) {
      throw new ModelProtocolError(
        ModelErrorCode.InvalidModelRequest,
        "MuseSessionModelAdapter requires api.type=muse-session-protocol",
        { providerId: options.providerId, apiType: options.providerConfig.api?.type },
      );
    }
    return createModel({
      providerId: options.providerId as never,
      modelId: options.modelId as never,
      ...(options.displayName !== undefined ? { displayName: options.displayName } : {}),
      properties: options.modelConfig.properties as ModelProperties,
      optionSpecs: options.modelConfig.optionSpecs as unknown as ModelOptionSpecs,
      ...(options.options !== undefined ? { options: options.options } : {}),
      executor: this.#createExecutor(options.modelId),
    });
  }

  async dispose(): Promise<void> {
    await this.#host.dispose();
  }

  #createExecutor(modelId: string): ModelExecutor {
    return {
      generateText: (request) => this.#generateText(request, modelId),
      streamText: (request) => this.#runTurn(request, modelId),
    };
  }

  async #generateText(request: ModelExecutionRequest, modelId: string): Promise<ModelTextResult> {
    let text = "";
    let finishReason = "stop";
    let usage: ModelTextResult["usage"] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for await (const event of this.#runTurn(request, modelId)) {
      if (event.type === "text_delta") {
        text += event.text;
      } else if (event.type === "finish") {
        finishReason = event.finishReason;
        usage = event.usage;
      }
    }
    return { text, finishReason, usage };
  }

  /**
   * 执行一个 Muse 回合并把 MSP 事件归约为 ModelEvent 流。
   * 失败语义与 AI SDK 路径对齐：本地中止/宿主死亡/回合失败 → 抛出错误；
   * 正常完成 → finish 事件（usage 只在此出现）。
   */
  async *#runTurn(request: ModelExecutionRequest, modelId: string): AsyncGenerator<ModelEvent> {
    const client = await this.#acquireClient();
    const session = await this.#startSession(client, modelId);
    const reducer = new MuseTurnEventReducer();
    const approvalEvents: ModelEvent[] = [];
    try {
      this.#registerApprovalBridge(session, reducer, approvalEvents);
      const turn = await session.sendUserTurn({
        input: [{ type: "text", text: renderMuseTurnPrompt(request) }],
        reasoningEffort: toMuseReasoningEffort(request.options.reasoningLevel),
      });
      const outcome = yield* this.#pumpTurn(turn, reducer, request.abortSignal, approvalEvents);
      if (outcome.kind !== "completed") {
        throw new ModelProtocolError(
          ModelErrorCode.ModelRequestFailed,
          `Muse turn ended without a terminal: ${outcome.kind}`,
          { source: "muse-cli" },
        );
      }
      const params = outcome.params;
      if (params.terminal === "failed") {
        const turnError = params.error;
        throw new ModelProtocolError(
          ModelErrorCode.ModelRequestFailed,
          `Muse turn failed: ${turnError?.kind ?? "unknown"}`,
          { source: "muse-cli", ...(turnError ? { turnError } : {}) },
        );
      }
      yield* approvalEvents;
      yield reducer.completed(params);
    } finally {
      void session.leave().catch(() => undefined);
    }
  }

  #registerApprovalBridge(session: Session, reducer: MuseTurnEventReducer, approvalEvents: ModelEvent[]): void {
    session.onApproval((approvalRequest): ApprovalDecisionInput => {
      reducer.noteApprovalRequest(approvalRequest);
      const decision = decideMuseApproval(approvalRequest, this.#policy);
      approvalEvents.push({
        type: "provider_tool_result",
        toolCallId: approvalRequest.toolCallId ?? approvalRequest.approvalId,
        toolName: approvalRequest.toolName ?? "muse-approval",
        output: {
          kind: "muse-approval",
          subject: summarizeApprovalSubject(approvalRequest),
          decision: (approvalRequest.availableChoices ?? []).find(
            (choice) => choice.choiceId === decision.choiceId,
          )?.decision ?? "unknown",
          policy: this.#policy,
        },
        isError: !isApprovalApproved(decision, approvalRequest),
      });
      return decision;
    });
    session.onApprovalError((failure: ApprovalFailure) => {
      this.#logger?.warn("muse approval round trip failed", {
        kind: failure.kind,
        approvalId: failure.approvalId,
      });
    });
  }

  /**
   * 并发泵取 items/deltas/completed 三路信号；终止条件是
   * completed 落定 **且** 两个迭代器排空（settle 后 SDK 先冲刷缓冲再 done）。
   * 中止：立即 interrupt + 抛出中止原因（AI SDK 同语义）。
   */
  async *#pumpTurn(
    turn: Turn,
    reducer: MuseTurnEventReducer,
    abortSignal: AbortSignal | undefined,
    approvalEvents: ModelEvent[],
  ): AsyncGenerator<ModelEvent, TurnOutcome> {
    let abortReason: unknown;
    const onAbort = () => {
      abortReason =
        abortSignal?.reason instanceof Error
          ? abortSignal.reason
          : new Error(String(abortSignal?.reason ?? "aborted"));
      void turn.interrupt().catch(() => undefined);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    // 中止必须是竞争赛道之一：否则两个迭代器挂起时（长工具回合），中止信号
    // 永远等不到循环顶部的检查——这正是要防止的悬挂。
    const abortRace: Promise<{ lane: "abort" }> = new Promise((resolve) => {
      if (abortSignal?.aborted) {
        resolve({ lane: "abort" });
      } else {
        abortSignal?.addEventListener("abort", () => resolve({ lane: "abort" }), { once: true });
      }
    });
    const never: Promise<never> = new Promise(() => undefined);
    try {
      const itemIterator = turn.items();
      const deltaIterator = turn.deltas();
      let itemNext: Promise<IteratorResult<unknown>> = itemIterator.next();
      let deltaNext: Promise<IteratorResult<unknown>> = deltaIterator.next();
      let outcome: TurnOutcome | undefined;
      let completionError: unknown;
      let itemExhausted = false;
      let deltaExhausted = false;
      const completedRace = turn.completed.then(
        (settled) => ({ outcome: settled }),
        (error: unknown) => {
          completionError = error;
          return { outcome: undefined };
        },
      );
      while (true) {
        if (approvalEvents.length > 0) {
          yield* approvalEvents.splice(0, approvalEvents.length);
        }
        if (abortReason !== undefined) {
          throw abortReason;
        }
        if (outcome !== undefined && itemExhausted && deltaExhausted) {
          break;
        }
        const winner = await Promise.race([
          itemNext.then((value) => ({ lane: "item" as const, value })),
          deltaNext.then((value) => ({ lane: "delta" as const, value })),
          completedRace.then((value) => ({ lane: "completed" as const, value })),
          abortRace,
        ]);
        if (winner.lane === "abort") {
          throw abortReason ?? new Error("aborted");
        } else if (winner.lane === "item") {
          const result = winner.value as IteratorResult<unknown>;
          if (result.done === true) {
            itemExhausted = true;
            itemNext = never;
          } else {
            const entry = result.value as Parameters<MuseTurnEventReducer["item"]>[0];
            yield* reducer.item(entry);
            yield* reducer.itemCompletedAgentText(entry);
            const end = reducer.itemCompletedAgentEnd(entry);
            if (end !== undefined) yield end;
            itemNext = itemIterator.next();
          }
        } else if (winner.lane === "delta") {
          const result = winner.value as IteratorResult<unknown>;
          if (result.done === true) {
            deltaExhausted = true;
            deltaNext = never;
          } else {
            const event = reducer.delta(result.value as MuseItemDeltaParams);
            if (event !== undefined) yield event;
            deltaNext = deltaIterator.next();
          }
        } else {
          outcome = winner.value.outcome ?? undefined;
          if (outcome === undefined) {
            outcome = { kind: "terminalUnknown" };
          }
        }
        if (completionError !== undefined) {
          throw completionError;
        }
      }
      if (outcome === undefined) {
        throw new ModelProtocolError(ModelErrorCode.ModelRequestFailed, "Muse turn settled without outcome", {
          source: "muse-cli",
        });
      }
      return outcome;
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  async #acquireClient(): Promise<MuseClient> {
    try {
      return await this.#host.getClient();
    } catch (error) {
      if (isMuseHostDeath(error)) this.#host.resetClient();
      throw toModelStartupError(error);
    }
  }

  async #startSession(client: MuseClient, modelId: string): Promise<Session> {
    try {
      return await client.startSession({
        workspaceRoot: this.#workspaceRoot,
        modelId,
      });
    } catch (error) {
      if (isMuseHostDeath(error)) this.#host.resetClient();
      throw toModelStartupError(error);
    }
  }
}

function isApprovalApproved(
  decision: ApprovalDecisionInput,
  request: { availableChoices?: ReadonlyArray<{ choiceId: string; decision: string }> },
): boolean {
  const chosen = (request.availableChoices ?? []).find((choice) => choice.choiceId === decision.choiceId);
  return chosen?.decision.startsWith("approved") === true;
}

function summarizeApprovalSubject(request: {
  subject?: { kind?: string; command?: string; host?: string; access?: string };
}): string {
  const subject = request.subject;
  if (subject === undefined) return "unknown";
  const detail = subject.command ?? subject.host ?? subject.access;
  return detail === undefined ? (subject.kind ?? "unknown") : `${subject.kind ?? "unknown"}: ${detail}`;
}

/** 把宿主启动/握手失败归一为带可操作信息的 Model 协议错误。 */
export function toModelStartupError(error: unknown): Error {
  const failure = (error as { failure?: { kind?: string }; stderrTail?: readonly string[] }) ?? {};
  if (typeof failure.failure?.kind === "string") {
    const tail = (failure.stderrTail ?? []).slice(-3).join(" | ");
    return new ModelProtocolError(
      ModelErrorCode.ModelRequestFailed,
      `Muse Code CLI host failed to start (${failure.failure.kind})${tail ? `: ${tail}` : ""}`,
      { source: "muse-cli", startFailure: failure.failure.kind },
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
