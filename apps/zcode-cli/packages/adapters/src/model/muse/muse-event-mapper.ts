/**
 * MSP 会话事件 → ZCode ModelStreamEvent 的归约映射。
 *
 * 关键语义（ACR-0002）：
 * - Muse 的 toolCall/webSearch 等 item 是 **provider 侧已执行** 的工具活动，
 *   映射为 `tool_input_start/providerExecuted` + `provider_tool_result`——
 *   MOS 的工具执行环不参与、也不会重复执行；MOS 自身的模型 tool_call 永不出现。
 * - 文本流来自 `item/delta`（field 缺省即 "text"）；`item/completed` 是权威终态，
 *   若该 item 从未见过增量（补齐/重放路径），补发一次全量 text_delta。
 * - reasoning item 只在完成时提交文本（MSP v1 不流式 reasoning），映射为一次性
 *   start/delta/end 三元组。
 * - usage 只在 turn/completed 出现（与 ZCode 的 finish 事件语义一致）。
 */

import type { ApprovalHandler, FoldedItem, Turn, TurnOutcome } from "@muse-code/sdk";
import type { ModelEvent, ModelUsage } from "@zcode/contracts";

/** 从 SDK 门面推导 wire 类型（SDK 不直接导出这些生成类型）。 */
export type MuseItemDeltaParams = NonNullable<
  Awaited<ReturnType<Turn["deltas"]>> extends AsyncIterableIterator<infer T> ? T : never
>;
export type MuseTurnCompletedParams = Extract<TurnOutcome, { kind: "completed" }>["params"];
/** SDK 门面未直接导出生成的审批 wire 类型；从 handler 参数推导。 */
export type MuseApprovalRequestParams = Parameters<ApprovalHandler>[0];

const TOOL_NAME_FALLBACK = "muse-tool";
const TOOL_OUTPUT_TEXT_LIMIT = 4_000;

/** 一次 Muse 回合的归约器；实例不可跨回合复用。 */
export class MuseTurnEventReducer {
  readonly #deltaChars = new Map<string, number>();
  readonly #textStarts = new Set<string>();
  readonly #textEnds = new Set<string>();
  readonly #toolStarts = new Set<string>();
  readonly #toolNames = new Map<string, string>();

  /** 审批请求先于工具 item 到达，携带 toolCallId + toolName；记下用于展示。 */
  noteApprovalRequest(request: MuseApprovalRequestParams): void {
    const toolCallId = request.toolCallId ?? undefined;
    if (toolCallId !== undefined && request.toolName) {
      this.#toolNames.set(toolCallId, request.toolName);
    }
  }

  /** `item/started` / `item/completed`（fold 快照，一次修订一投递）。 */
  item(entry: FoldedItem): ModelEvent[] {
    const events: ModelEvent[] = [];
    const itemId = entry.itemId;
    switch (entry.kind) {
      case "agentMessage": {
        // 终态快照交给 itemCompletedAgentText/itemCompletedAgentEnd（补齐顺序保证
        // text_end 之前的全量回填）；这里只负责 inProgress 的 text_start 唯一性。
        if (entry.status !== "inProgress") break;
        if (this.#textStarts.has(itemId)) break;
        this.#textStarts.add(itemId);
        events.push({ type: "text_start", id: itemId });
        break;
      }
      case "reasoning": {
        if (entry.status === "inProgress") break;
        const text = typeof entry.text === "string" ? entry.text : "";
        events.push({ type: "reasoning_start", id: itemId });
        if (text.length > 0) {
          events.push({ type: "reasoning_delta", id: itemId, text });
        }
        events.push({ type: "reasoning_end", id: itemId });
        break;
      }
      case "toolCall":
      case "webSearch":
      case "userShell": {
        // DeepReadonly 会把开放字符串枚举（string & {}）映射成对象怪物类型；
        // 运行时它们就是 string，用 String() 归一。
        const kind = String(entry.kind);
        const toolCallId = String(entry.callId ?? itemId);
        const toolName = this.#toolNames.get(toolCallId) ?? kind;
        if (!this.#toolStarts.has(itemId)) {
          this.#toolStarts.add(itemId);
          events.push({ type: "tool_input_start", id: itemId, toolName, providerExecuted: true });
          events.push({ type: "tool_input_end", id: itemId });
        }
        if (entry.status !== "inProgress") {
          const toolText = typeof entry.text === "string" ? entry.text : "";
          const summaryParts = Array.isArray(entry.summary) ? [...entry.summary] : [];
          events.push({
            type: "provider_tool_result",
            toolCallId,
            toolName,
            output: {
              kind: "muse-tool-call",
              itemKind: kind,
              status: String(entry.status),
              ...(summaryParts.length > 0 ? { summary: summaryParts.join("\n") } : {}),
              ...(toolText.length > 0 ? { text: toolText.slice(0, TOOL_OUTPUT_TEXT_LIMIT) } : {}),
            },
            isError: entry.status !== "completed",
          });
        }
        break;
      }
      default:
        // 其余 item 种类（subagent/workflow/hookRun/systemNotice…）不进入 v1 投影；
        // agentMessage 文本与工具活动已覆盖可见执行证据。
        break;
    }
    return events;
  }

  /** `item/delta`：默认 field 即 "text"；仅统计 agentMessage 的文本增量。 */
  delta(params: MuseItemDeltaParams): ModelEvent | undefined {
    const field = params.field ?? "text";
    if (field !== "text") return undefined;
    this.#deltaChars.set(params.itemId, (this.#deltaChars.get(params.itemId) ?? 0) + params.delta.length);
    return { type: "text_delta", id: params.itemId, text: params.delta };
  }

  /**
   * agentMessage 终态：从未见过增量（重放/补齐/终端优先）时补发 text_start
   * （若还没有）与一次全量 text_delta；text_end 由 itemCompletedAgentEnd 发出。
   */
  itemCompletedAgentText(entry: FoldedItem): ModelEvent[] {
    if (entry.kind !== "agentMessage" || entry.status === "inProgress") return [];
    const events: ModelEvent[] = [];
    if (!this.#textStarts.has(entry.itemId)) {
      this.#textStarts.add(entry.itemId);
      events.push({ type: "text_start", id: entry.itemId });
    }
    const seen = this.#deltaChars.get(entry.itemId) ?? 0;
    const text = typeof entry.text === "string" ? entry.text : "";
    if (seen === 0 && text.length > 0) {
      this.#deltaChars.set(entry.itemId, text.length);
      events.push({ type: "text_delta", id: entry.itemId, text });
    }
    return events;
  }

  /** agentMessage 终态的 text_end（每 item 一次）。 */
  itemCompletedAgentEnd(entry: FoldedItem): ModelEvent | undefined {
    if (entry.kind !== "agentMessage" || entry.status === "inProgress") return undefined;
    if (this.#textEnds.has(entry.itemId)) return undefined;
    this.#textEnds.add(entry.itemId);
    return { type: "text_end", id: entry.itemId };
  }

  /** `turn/completed` → finish（或失败时抛出的依据）。 */
  completed(params: MuseTurnCompletedParams): ModelEvent {
    return {
      type: "finish",
      finishReason: params.terminal === "cancelled" ? "cancelled" : "stop",
      usage: toModelUsage(params.usage),
      providerMetadata: {
        muse: {
          turnTerminal: params.terminal,
          ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
          ...(params.timeToFirstTokenMs !== undefined
            ? { timeToFirstTokenMs: params.timeToFirstTokenMs }
            : {}),
          ...(params.error !== undefined ? { turnError: params.error } : {}),
        },
      },
    };
  }
}

interface MuseTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
}

export function toModelUsage(usage: MuseTokenUsage | undefined): ModelUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(usage?.cachedTokens !== undefined ? { cacheReadTokens: usage.cachedTokens } : {}),
    ...(usage?.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
}
