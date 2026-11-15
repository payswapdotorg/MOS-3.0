import { describe, expect, it } from "vitest";
import { MUSE_EXEC_JSONL_MAPPING_VERSION, parseMuseExecJsonlLine } from "../src/muse-code/muse-exec-jsonl.js";
// muse exec --json JSONL 映射的契约测试（Issue #24 / ACR-0002）。
// 映射表是候选实现：真实 CLI 的事件 schema 必须在用户机器上验证后回填
// （spec/integrations/provider-evidence/muse-code-connector-evidence.md）；
// 这里锁定的是「宽容映射 + 未知计数 + 绝不猜测」的行为契约。

describe("parseMuseExecJsonlLine", () => {
  it("maps documented candidate text delta and end events", () => {
    expect(parseMuseExecJsonlLine(JSON.stringify({ type: "assistant_text_delta", text: "hi" }))).toEqual({
      status: "event",
      event: { kind: "text_delta", text: "hi" },
    });
    expect(parseMuseExecJsonlLine(JSON.stringify({ type: "text_delta", delta: "there" }))).toEqual({
      status: "event",
      event: { kind: "text_delta", text: "there" },
    });
    expect(parseMuseExecJsonlLine(JSON.stringify({ type: "assistant_text_end" }))).toEqual({
      status: "event",
      event: { kind: "text_end" },
    });
  });

  it("maps tool activity with status and summary, tolerating id-less events", () => {
    const started = parseMuseExecJsonlLine(JSON.stringify({ type: "tool_call", toolName: "Read" }));
    expect(started).toEqual({
      status: "event",
      event: { kind: "tool_activity", status: "started", toolCallId: "", toolName: "Read" },
    });
    const done = parseMuseExecJsonlLine(
      JSON.stringify({ type: "tool_result", tool: "Read", summary: "read 12 lines" }),
    );
    expect(done).toEqual({
      status: "event",
      event: {
        kind: "tool_activity",
        status: "completed",
        toolCallId: "",
        toolName: "Read",
        summary: "read 12 lines",
      },
    });
  });

  it("maps error events and keeps their code", () => {
    const parsed = parseMuseExecJsonlLine(
      JSON.stringify({ type: "error", message: "quota exhausted", code: "E_QUOTA" }),
    );
    expect(parsed).toEqual({
      status: "event",
      event: { kind: "error", message: "quota exhausted", code: "E_QUOTA" },
    });
  });

  it("counts unknown and non-object lines instead of guessing semantics", () => {
    expect(parseMuseExecJsonlLine(JSON.stringify({ type: "session", id: "s1" }))).toEqual({
      status: "unknown",
      type: "session",
    });
    expect(parseMuseExecJsonlLine("just a string")).toEqual({ status: "invalid" });
    expect(parseMuseExecJsonlLine("42")).toEqual({ status: "unknown" });
    expect(parseMuseExecJsonlLine("this is not json")).toEqual({ status: "invalid" });
    expect(parseMuseExecJsonlLine("   ")).toEqual({ status: "empty" });
    expect(parseMuseExecJsonlLine(JSON.stringify([1, 2]))).toEqual({ status: "unknown" });
  });

  it("maps candidate approval-request and user-question events (R3)", () => {
    expect(
      parseMuseExecJsonlLine(
        JSON.stringify({ type: "approval_request", toolName: "Bash", message: "run tests" }),
      ),
    ).toEqual({
      status: "event",
      event: { kind: "approval_required", toolName: "Bash", summary: "run tests" },
    });
    expect(
      parseMuseExecJsonlLine(JSON.stringify({ type: "permission_request", toolName: "Edit" })),
    ).toEqual({
      status: "event",
      event: { kind: "approval_required", toolName: "Edit" },
    });
    expect(
      parseMuseExecJsonlLine(JSON.stringify({ type: "user_question", question: "Which DB?" })),
    ).toEqual({
      status: "event",
      event: { kind: "user_question", summary: "Which DB?" },
    });
    // 无 question 文本的提问事件不能凭空捏造内容 → 计数不猜测。
    expect(parseMuseExecJsonlLine(JSON.stringify({ type: "question" }))).toEqual({
      status: "unknown",
      type: "question",
    });
  });

  it("captures candidate envelope session ids without inventing them (R2)", () => {
    expect(
      parseMuseExecJsonlLine(
        JSON.stringify({ type: "assistant_text_delta", text: "hi", session_id: "muse-s-1" }),
      ),
    ).toEqual({
      status: "event",
      event: { kind: "text_delta", text: "hi" },
      museSessionId: "muse-s-1",
    });
    expect(
      parseMuseExecJsonlLine(
        JSON.stringify({ type: "tool_call", toolName: "Read", sessionId: "muse-s-2" }),
      ),
    ).toEqual({
      status: "event",
      event: { kind: "tool_activity", status: "started", toolCallId: "", toolName: "Read" },
      museSessionId: "muse-s-2",
    });
    // 未申报 session id 的事件不得虚构。
    expect(
      parseMuseExecJsonlLine(JSON.stringify({ type: "assistant_text_end" })),
    ).toEqual({ status: "event", event: { kind: "text_end" } });
  });

  it("truncates oversized summaries so tool output never floods session events", () => {
    const long = "x".repeat(5000);
    const parsed = parseMuseExecJsonlLine(JSON.stringify({ type: "tool_result", tool: "Bash", summary: long }));
    expect(parsed.status).toBe("event");
    if (parsed.status !== "event") return;
    expect(parsed.event.kind).toBe("tool_activity");
    if (parsed.event.kind !== "tool_activity") return;
    expect(parsed.event.summary?.length ?? 0).toBeLessThanOrEqual(2001);
  });

  it("exposes a versioned mapping table for on-machine reconciliation", () => {
    expect(MUSE_EXEC_JSONL_MAPPING_VERSION).toBeGreaterThan(0);
  });
});
