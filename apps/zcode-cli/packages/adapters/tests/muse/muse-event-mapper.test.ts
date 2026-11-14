/**
 * MSP 事件 → ModelStreamEvent 归约契约测试（ACR-0002）。
 * 帧字面量取自 @muse-code/sdk 公开 conformance transcript
 * (schema/msp/transcripts/text-run-single-turn) 与本机 `muse serve` 实测握手，
 * 字段以 msp.d.ts 生成类型为准。
 */

import { describe, expect, it } from "vitest";
import { MuseTurnEventReducer } from "../../src/model/muse/muse-event-mapper.js";
import type { ModelEvent } from "@zcode/contracts";

const ITEM_ID = "0198f0ac-4242-7000-8000-000000000042";

function agentMessageItem(status: string, text: string) {
  return {
    itemId: ITEM_ID,
    kind: "agentMessage",
    revision: status === "inProgress" ? 1 : 2,
    status,
    ...(status === "completed" ? { recordedAt: "2026-08-07T18:42:31.400Z", text } : {}),
  } as Parameters<MuseTurnEventReducer["item"]>[0];
}

function toolCallItem(status: string, callId: string, text: string) {
  return {
    itemId: `item-${callId}`,
    callId,
    kind: "toolCall",
    revision: 2,
    status,
    summary: ["ran cargo test"],
    ...(status !== "inProgress" ? { text } : {}),
  } as Parameters<MuseTurnEventReducer["item"]>[0];
}

describe("agentMessage 文本流", () => {
  it("started → text_start；delta → text_delta；completed → text_end", () => {
    const reducer = new MuseTurnEventReducer();
    expect(reducer.item(agentMessageItem("inProgress", ""))).toEqual([
      { type: "text_start", id: ITEM_ID },
    ]);
    expect(
      reducer.delta({ itemId: ITEM_ID, delta: "All 214 tests pass", viewCursor: "v1" } as never),
    ).toEqual({ type: "text_delta", id: ITEM_ID, text: "All 214 tests pass" });
    expect(
      reducer.delta({ itemId: ITEM_ID, delta: " except two", viewCursor: "v2" } as never),
    ).toEqual({ type: "text_delta", id: ITEM_ID, text: " except two" });
    const events = reducer.item(agentMessageItem("completed", "All 214 tests pass except two"));
    expect(events).toEqual([]);
    // 增量已见过：终态不补发全量，也不重复。
    expect(
      reducer.itemCompletedAgentText(agentMessageItem("completed", "All 214 tests pass except two")),
    ).toEqual([]);
    expect(reducer.itemCompletedAgentEnd(agentMessageItem("completed", "All 214 tests pass except two"))).toEqual({
      type: "text_end",
      id: ITEM_ID,
    });
  });

  it("completed with no prior deltas back-fills start + one full text_delta (replay/gap path)", () => {
    const reducer = new MuseTurnEventReducer();
    reducer.item(agentMessageItem("inProgress", ""));
    const backfill = reducer.itemCompletedAgentText(agentMessageItem("completed", "final answer"));
    expect(backfill).toEqual([{ type: "text_delta", id: ITEM_ID, text: "final answer" }]);
  });

  it("terminal-first agentMessage (never saw started) gets start + backfill + end in order", () => {
    const reducer = new MuseTurnEventReducer();
    const terminal = agentMessageItem("completed", "one-shot");
    expect(reducer.item(terminal)).toEqual([]);
    expect(reducer.itemCompletedAgentText(terminal)).toEqual([
      { type: "text_start", id: ITEM_ID },
      { type: "text_delta", id: ITEM_ID, text: "one-shot" },
    ]);
    expect(reducer.itemCompletedAgentEnd(terminal)).toEqual({ type: "text_end", id: ITEM_ID });
  });

  it("does not duplicate text when deltas were seen", () => {
    const reducer = new MuseTurnEventReducer();
    reducer.item(agentMessageItem("inProgress", ""));
    reducer.delta({ itemId: ITEM_ID, delta: "abc", viewCursor: "v1" } as never);
    expect(reducer.itemCompletedAgentText(agentMessageItem("completed", "abc"))).toEqual([]);
  });

  it("text_start is emitted once per item even on repeated snapshots", () => {
    const reducer = new MuseTurnEventReducer();
    reducer.item(agentMessageItem("inProgress", ""));
    expect(reducer.item(agentMessageItem("inProgress", ""))).toEqual([]);
  });
});

describe("toolCall / webSearch / userShell（provider 侧执行）", () => {
  it("emits providerExecuted tool_input start/end + provider_tool_result with bounded output", () => {
    const reducer = new MuseTurnEventReducer();
    const long = "x".repeat(10_000);
    const events: ModelEvent[] = [
      ...reducer.item(toolCallItem("inProgress", "call_9", "")),
      ...reducer.item(toolCallItem("completed", "call_9", long)),
    ];
    expect(events[0]).toMatchObject({
      type: "tool_input_start",
      toolName: "toolCall",
      providerExecuted: true,
    });
    expect(events[1]).toMatchObject({ type: "tool_input_end" });
    const result = events.find((event) => event.type === "provider_tool_result");
    expect(result).toMatchObject({
      type: "provider_tool_result",
      toolCallId: "call_9",
      toolName: "toolCall",
      isError: false,
    });
    const output = (result as { output: { text?: string } }).output;
    expect(output.text?.length).toBe(4_000);
  });

  it("marks failed tool calls as errors", () => {
    const reducer = new MuseTurnEventReducer();
    const events = reducer.item(toolCallItem("failed", "call_8", "boom"));
    const result = events.find((event) => event.type === "provider_tool_result");
    expect(result).toMatchObject({ isError: true });
  });

  it("uses the toolName learned from the approval request", () => {
    const reducer = new MuseTurnEventReducer();
    reducer.noteApprovalRequest({
      approvalId: "a1",
      toolCallId: "call_7",
      toolName: "bash",
      availableChoices: [],
    } as never);
    const events = reducer.item(toolCallItem("completed", "call_7", "ok"));
    expect(events.find((event) => event.type === "provider_tool_result")).toMatchObject({
      toolName: "bash",
    });
  });
});

describe("reasoning（一次性三元组）", () => {
  it("completed reasoning maps to start/delta/end with committed text", () => {
    const reducer = new MuseTurnEventReducer();
    const events = reducer.item({
      itemId: "rs_1",
      kind: "reasoning",
      revision: 2,
      status: "completed",
      text: "thinking...",
    } as never);
    expect(events).toEqual([
      { type: "reasoning_start", id: "rs_1" },
      { type: "reasoning_delta", id: "rs_1", text: "thinking..." },
      { type: "reasoning_end", id: "rs_1" },
    ]);
  });

  it("in-progress reasoning is skipped (MSP v1 不流式 reasoning)", () => {
    const reducer = new MuseTurnEventReducer();
    expect(
      reducer.item({ itemId: "rs_1", kind: "reasoning", revision: 1, status: "inProgress" } as never),
    ).toEqual([]);
  });
});

describe("turn/completed → finish", () => {
  it("maps completed terminal with TokenUsage → ModelUsage", () => {
    const reducer = new MuseTurnEventReducer();
    const finish = reducer.completed({
      terminal: "completed",
      durationMs: 48_211,
      timeToFirstTokenMs: 902,
      usage: { inputTokens: 48_210, outputTokens: 1_211, cachedTokens: 40_100, reasoningTokens: 384 },
    } as never);
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "stop",
      usage: {
        inputTokens: 48_210,
        outputTokens: 1_211,
        cacheReadTokens: 40_100,
        reasoningTokens: 384,
        totalTokens: 49_421,
      },
    });
  });

  it("maps cancelled terminal without usage", () => {
    const reducer = new MuseTurnEventReducer();
    const finish = reducer.completed({ terminal: "cancelled" } as never);
    expect(finish).toMatchObject({ type: "finish", finishReason: "cancelled" });
  });
});
