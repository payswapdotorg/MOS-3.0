import { describe, expect, it } from "vitest";
import type { MessageId, SessionEvent, TraceContext, TurnId } from "@zcode/contracts";
import { createSessionEvent, SessionEventType } from "@zcode/contracts";
import { TurnMachineImpl } from "../src/agent/turn-machine.js";
import type { MessagePart } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import {
  MUSE_EXEC_TURN_UNAVAILABLE_CODE,
  runDelegatedMuseTurn,
} from "../src/runtime/methods/delegated-muse-turn.js";
// 委托 Muse Code turn 执行器的契约测试（Issue #24 / ACR-0002）。
// 端口用脚本化 fake（mock）：验证事件投影（ModelStreaming / ToolCall*）、
// assistant 消息与 text part 持久化、取消/失败收口与归因（muse-code/muse-exec）。
// 这是 contract-tested 证据，不是真实 CLI 执行证据（AGENTS.md §7）。

interface ScriptedPortRun {
  handlers: {
    onEvent(event: import("@zcode/contracts").MuseExecStreamEvent): Promise<void> | void;
  };
  request: import("@zcode/contracts").MuseExecRequest;
}

function createScriptedMusePort(script: (run: ScriptedPortRun) => Promise<void>) {
  return {
    async runMuseExec(request: import("@zcode/contracts").MuseExecRequest, handlers: ScriptedPortRun["handlers"]) {
      await script({ handlers, request });
      return {
        cancelled: request.signal.aborted,
        exitCode: 0,
        stderrTail: "",
        timedOut: false,
        unknownEventCount: 1,
      } satisfies import("@zcode/contracts").MuseExecRunResult;
    },
  };
}

function createStubRuntime(
  port: unknown,
): {
  runtime: AgentRuntimeInternal;
  appended: SessionEvent[];
  persistedMessages: Record<string, unknown>[];
  persistedParts: MessagePart[];
} {
  const appended: SessionEvent[] = [];
  const persistedMessages: Record<string, unknown>[] = [];
  const persistedParts: MessagePart[] = [];
  const traceContext: TraceContext = { traceId: "trace_muse_test", turnId: "turn_muse_test" as TurnId };
  const runtime = {
    sessionId: "sess_muse_test",
    workingDirectory: "/workspace/fixture",
    workspaceRoot: "/workspace/fixture",
    config: { mode: "build" },
    getPlanEnabled: () => false,
    getMode: () => "build",
    sessionStore: {
      saveMessage: async (message: Record<string, unknown>) => {
        persistedMessages.push(message);
      },
      savePart: async (part: MessagePart) => {
        persistedParts.push(part);
      },
    },
    createEvent: (type: SessionEventType, payload: unknown, trace: TraceContext) =>
      createSessionEvent(type, "sess_muse_test", payload, {
        turnId: trace.turnId,
        traceId: trace.traceId,
      }),
    appendEvent: async (event: SessionEvent) => {
      appended.push(event);
    },
    persistMessage: async (message: Record<string, unknown>) => {
      persistedMessages.push(message);
    },
    persistPart: async (part: MessagePart) => {
      persistedParts.push(part);
    },
    logger: undefined,
    museExecutionPort: port,
  } as unknown as AgentRuntimeInternal;
  return { appended, persistedMessages, persistedParts, runtime };
}

function baseParams(
  runtime: AgentRuntimeInternal,
  signal: AbortSignal,
  events: SessionEvent[],
): Parameters<typeof runDelegatedMuseTurn>[1] {
  return {
    input: "fix the failing parser test",
    userMessageId: "msg_user_1" as MessageId,
    turnId: "turn_muse_test" as TurnId,
    // executeTurnCommand 在进入执行分支前已 start 机器；这里镜像同一前置状态。
    ...(() => {
      const created = TurnMachineImpl.create(
        "sess_muse_test",
        1,
        "fix the failing parser test",
        "trace_muse_test",
        "turn_muse_test" as TurnId,
      );
      return { turnMachine: new TurnMachineImpl(created.start()) };
    })(),
    turnAbortSignal: signal,
    turnTraceContext: { traceId: "trace_muse_test", turnId: "turn_muse_test" as TurnId },
    events,
    turnStartedAtMs: Date.now(),
  };
}

describe("runDelegatedMuseTurn", () => {
  it("streams text and tool activity into standard session events and persists them", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      await run.handlers.onEvent({ kind: "text_delta", text: "Hello " });
      await run.handlers.onEvent({
        kind: "tool_activity",
        status: "started",
        toolCallId: "muse:Read:1",
        toolName: "Read",
      });
      await run.handlers.onEvent({
        kind: "tool_activity",
        durationMs: 12,
        status: "completed",
        summary: "read 12 lines",
        toolCallId: "muse:Read:1",
        toolName: "Read",
      });
      await run.handlers.onEvent({ kind: "text_delta", text: "world" });
      await run.handlers.onEvent({ kind: "text_end" });
      // 提示必须按会话工作区约束原样交给端口。
      expect(run.request.prompt).toBe("fix the failing parser test");
      expect(run.request.workingDirectory).toBe("/workspace/fixture");
    });
    const { appended, persistedMessages, persistedParts, runtime } = createStubRuntime(port);
    const events: SessionEvent[] = [];
    const result = await runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, events));

    expect(result.response).toBe("Hello world");
    expect(result.toolCallCount).toBe(1);
    const appendedTypes = appended.map((event) => event.type);
    expect(appendedTypes).toContain(SessionEventType.ToolCallStarted);
    expect(appendedTypes).toContain(SessionEventType.ToolCallResult);
    const streamingKinds = events
      .filter((event) => event.type === SessionEventType.ModelStreaming)
      .map((event) => (event.payload as { kind?: string }).kind);
    expect(streamingKinds).toEqual(
      expect.arrayContaining(["start", "text_start", "text_delta", "text_end", "finish"]),
    );
    // 持久化：text part 全文落库（冷恢复可见），assistant 消息完成并诚实归因。
    const textPart = persistedParts.find((part) => part.type === "text");
    expect(textPart && textPart.type === "text" ? textPart.text : "").toBe("Hello world");
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.finish).toBe("muse_turn_complete");
    expect(assistant?.providerId).toBe("muse-code");
    expect(assistant?.modelId).toBe("muse-exec");
    expect(typeof assistant?.time?.completed).toBe("number");
  });

  it("fails closed when the runtime has no muse execution port", async () => {
    const { runtime } = createStubRuntime(undefined);
    const controller = new AbortController();
    await expect(
      runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, [])),
    ).rejects.toMatchObject({ code: MUSE_EXEC_TURN_UNAVAILABLE_CODE });
  });

  it("propagates cancellation, persists partial text and settles the assistant message", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      await run.handlers.onEvent({ kind: "text_delta", text: "partial work" });
      controller.abort(new Error("user stopped the task"));
      // 端口终止进程树后返回；下一个事件到达时调用方必须停止投影并抛出取消。
      await run.handlers.onEvent({ kind: "text_delta", text: " should not project" });
    });
    const { appended, persistedMessages, persistedParts, runtime } = createStubRuntime(port);
    const events: SessionEvent[] = [];
    await expect(
      runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, events)),
    ).rejects.toThrow();
    const streamedText = events
      .filter((event) => event.type === SessionEventType.ModelStreaming)
      .map((event) => (event.payload as { delta?: string }).delta ?? "")
      .join("");
    expect(streamedText).not.toContain("should not project");
    // 取消后不得再投影任何事件（含 appendEvent 路径）。
    for (const event of appended) {
      expect(JSON.stringify(event.payload)).not.toContain("should not project");
    }
    const textPart = persistedParts.find((part) => part.type === "text");
    expect(textPart && textPart.type === "text" ? textPart.text : "").toBe("partial work");
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.finish).toBe("muse_turn_cancelled");
    expect((assistant?.error as { data?: { turnResult?: string } })?.data?.turnResult).toBe(
      "cancelled",
    );
  });

  it("surfaces nonzero CLI exits as turn failures with persisted partial output", async () => {
    const controller = new AbortController();
    const port = {
      async runMuseExec(
        _request: import("@zcode/contracts").MuseExecRequest,
        handlers: ScriptedPortRun["handlers"],
      ) {
        await handlers.onEvent({ kind: "text_delta", text: "half answer" });
        return {
          cancelled: false,
          exitCode: 3,
          stderrTail: "boom detail",
          timedOut: false,
          unknownEventCount: 0,
        } satisfies import("@zcode/contracts").MuseExecRunResult;
      },
    };
    const { persistedMessages, persistedParts, runtime } = createStubRuntime(port);
    await expect(
      runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, [])),
    ).rejects.toThrow(/exited with code 3/);
    const textPart = persistedParts.find((part) => part.type === "text");
    expect(textPart && textPart.type === "text" ? textPart.text : "").toBe("half answer");
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.finish).toBe("muse_turn_error");
  });

  it("surfaces in-stream error events as turn failures", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      await run.handlers.onEvent({ kind: "error", message: "quota exhausted", code: "E_QUOTA" });
    });
    const { runtime } = createStubRuntime(port);
    await expect(
      runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, [])),
    ).rejects.toThrow(/quota exhausted/);
  });
});
