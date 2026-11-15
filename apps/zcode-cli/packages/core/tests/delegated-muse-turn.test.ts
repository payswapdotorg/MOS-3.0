import { describe, expect, it } from "vitest";
import type { MessageId, SessionEvent, TraceContext, TurnId } from "@zcode/contracts";
import { createSessionEvent, SessionEventType } from "@zcode/contracts";
import { TurnMachineImpl } from "../src/agent/turn-machine.js";
import type { MessagePart } from "@zcode/contracts";
import type { ModelSelection } from "../src/runtime/deps.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import {
  MUSE_EXEC_TURN_UNAVAILABLE_CODE,
  museDelegatedModelPinOf,
  runDelegatedMuseTurn,
} from "../src/runtime/methods/delegated-muse-turn.js";
// 委托 Muse Code turn 执行器的契约测试（Issue #24 / ACR-0002）。
// 端口用脚本化 fake（mock）：验证事件投影（ModelStreaming / ToolCall*）、
// assistant 消息与 text part 持久化、取消/失败收口与归因（muse-code/muse-exec）。
// MC-D 验证轮（TL correction round 2026-11-15）：有效选型命中家族时精确 modelId
// 钉到端口请求（museDelegatedModelPinOf；普通选型/缺选不钉），requested/effective/
// contributorModePolicy 归因入 metadata 与结果。
// 这是 contract-tested 证据，不是真实 CLI 执行证据（AGENTS.md §7）。

interface ScriptedPortRun {
  handlers: {
    onEvent(event: import("@zcode/contracts").MuseExecStreamEvent): Promise<void> | void;
  };
  request: import("@zcode/contracts").MuseExecRequest;
}

function createScriptedMusePort(
  script: (run: ScriptedPortRun) => Promise<void>,
  resultOverride?: Partial<import("@zcode/contracts").MuseExecRunResult>,
) {
  return {
    async runMuseExec(request: import("@zcode/contracts").MuseExecRequest, handlers: ScriptedPortRun["handlers"]) {
      await script({ handlers, request });
      return {
        cancelled: request.signal.aborted,
        exitCode: 0,
        stderrTail: "",
        timedOut: false,
        unknownEventCount: 1,
        surface: "muse-exec",
        resumedMuseSession: false,
        ...(resultOverride ?? {}),
        approvalRequestsObserved: 0,
        userQuestionsObserved: 0,
        approvalPosture: "fail-closed",
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
  modelSelection?: ModelSelection,
): Parameters<typeof runDelegatedMuseTurn>[1] {
  return {
    input: "fix the failing parser test",
    userMessageId: "msg_user_1" as MessageId,
    turnId: "turn_muse_test" as TurnId,
    ...(modelSelection ? { modelSelection } : {}),
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

describe("museDelegatedModelPinOf (MC-D 精确模型钉住)", () => {
  it("pins the selected family model id verbatim (never invents or rewrites)", () => {
    expect(
      museDelegatedModelPinOf({
        providerId: "meta",
        modelId: "muse-spark-1.3-contributor",
      }),
    ).toBe("muse-spark-1.3-contributor");
    expect(
      museDelegatedModelPinOf({
        providerId: "anything",
        modelId: "muse-spark-1.4-contributor",
      }),
    ).toBe("muse-spark-1.4-contributor");
  });

  it("does not pin ordinary or free-variant selections (CLI-default path unchanged)", () => {
    expect(
      museDelegatedModelPinOf({ providerId: "openrouter", modelId: "glm-5.3" }),
    ).toBeUndefined();
    // OpenCode Zen 免费变体保持显式免费 HTTP 路径，绝不钉到 CLI 订阅。
    expect(
      museDelegatedModelPinOf({
        providerId: "opencode-zen-chat",
        modelId: "muse-spark-1.2-contributor-free",
      }),
    ).toBeUndefined();
    expect(museDelegatedModelPinOf(undefined)).toBeUndefined();
  });
});

describe("runDelegatedMuseTurn", () => {
  it("passes the selected model id into the execution port request and records the pin evidence (MC-D)", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      await run.handlers.onEvent({ kind: "text_delta", text: "working" });
      // 选型钉住的精确 modelId 必须到达执行端口（不是只有路由判定为真）。
      expect(run.request.modelId).toBe("muse-spark-1.3-contributor");
    }, {
      requestedModelId: "muse-spark-1.3-contributor",
      effectiveModelId: "muse-spark-1.3-contributor",
      modelPinMechanism: "session-start",
    });
    const { persistedMessages, runtime } = createStubRuntime(port);
    const result = await runDelegatedMuseTurn.call(
      runtime,
      baseParams(
        runtime,
        controller.signal,
        [],
        { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
      ),
    );
    expect(result.response).toBe("working");
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    const museMetadata = (
      assistant?.metadata as { museExecution?: Record<string, unknown> } | undefined
    )?.museExecution;
    // 请求/实际生效模型与机制如实入 sanitized 证据；Contributor 模式归 CLI 自治。
    expect(museMetadata?.requestedModelId).toBe("muse-spark-1.3-contributor");
    expect(museMetadata?.effectiveModelId).toBe("muse-spark-1.3-contributor");
    expect(museMetadata?.modelPinMechanism).toBe("session-start");
    expect(museMetadata?.contributorModePolicy).toBe("cli-default");
  });

  it("keeps the port request model-free for ordinary selections (envelope-explicit path unchanged)", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      expect(run.request.modelId).toBeUndefined();
    });
    const { persistedMessages, runtime } = createStubRuntime(port);
    await runDelegatedMuseTurn.call(
      runtime,
      baseParams(
        runtime,
        controller.signal,
        [],
        // 显式信封字段路径下的普通选型：不钉（CLI 自身配置；既有行为不变）。
        { providerId: "openrouter", modelId: "glm-5.3" },
      ),
    );
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    const museMetadata = (
      assistant?.metadata as { museExecution?: Record<string, unknown> } | undefined
    )?.museExecution;
    expect(museMetadata?.requestedModelId).toBeUndefined();
    expect(museMetadata?.effectiveModelId).toBeUndefined();
    expect(museMetadata?.modelPinMechanism).toBeUndefined();
    expect(museMetadata?.contributorModePolicy).toBe("cli-default");
  });

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
      // 提示必须按会话工作区约束原样交给端口；会话身份与 workspace 根一并下发
      //（PR #27 评审 R2/R4：MOS sessionId 是 muse 会话映射键；workspaceRoot 是边界）。
      expect(run.request.prompt).toBe("fix the failing parser test");
      expect(run.request.workingDirectory).toBe("/workspace/fixture");
      expect(run.request.workspaceRoot).toBe("/workspace/fixture");
      expect(run.request.sessionId).toBe("sess_muse_test");
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
    // 用量诚实（R6）：订阅计量的委托轮没有货币成本——cost 必须是 null（未申报），
    // 绝不是 0（会被下游误读为免费）；metadata 明确标注 unreported。
    expect(assistant?.cost).toBeNull();
    const stepFinish = persistedParts.find((part) => part.type === "step-finish");
    expect(stepFinish && stepFinish.type === "step-finish" ? stepFinish.cost : undefined).toBeNull();
    const museMetadata = (
      assistant?.metadata as { museExecution?: { usageReporting?: string } } | undefined
    )?.museExecution;
    expect(museMetadata?.usageReporting).toBe("unreported");
  });

  it("attributes workspace-mismatch continuity resets in message metadata (R2 rev. 3)", async () => {
    const controller = new AbortController();
    // 端口报告：既有映射因 workspace 根不一致而未续接（rev. 3 resume 门控）。
    const port = createScriptedMusePort(async () => undefined, {
      museSessionId: "muse-session-fresh-2",
      sessionWorkspaceMismatch: true,
    });
    const events: SessionEvent[] = [];
    const { persistedMessages, runtime } = createStubRuntime(port);
    await runDelegatedMuseTurn.call(runtime, baseParams(runtime, controller.signal, events));
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    const museMetadata = (
      assistant?.metadata as { museExecution?: Record<string, unknown> } | undefined
    )?.museExecution;
    // 连续性重置必须可见（归因诚实），而不是静默丢上下文。
    expect(museMetadata?.sessionWorkspaceMismatch).toBe(true);
    expect(museMetadata?.resumedMuseSession).toBe(false);
    expect(museMetadata?.museSessionId).toBe("muse-session-fresh-2");
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
          surface: "muse-exec",
          resumedMuseSession: false,
          approvalRequestsObserved: 0,
          userQuestionsObserved: 0,
          approvalPosture: "fail-closed",
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

  it("projects approval requests and user questions as visible activity rows (R3)", async () => {
    const controller = new AbortController();
    const port = createScriptedMusePort(async (run) => {
      await run.handlers.onEvent({
        kind: "approval_required",
        summary: "run the test suite",
        toolName: "Bash",
      });
      await run.handlers.onEvent({ kind: "user_question", summary: "Which database engine?" });
      await run.handlers.onEvent({ kind: "text_delta", text: "continuing" });
    });
    const { appended, runtime } = createStubRuntime(port);
    const result = await runDelegatedMuseTurn.call(
      runtime,
      baseParams(runtime, controller.signal, []),
    );
    // 不代答/不代批：请求与提问如实投影为 ToolCall 行（fail-closed 拒绝在端口侧发生）。
    expect(result.approvalRequestsObserved).toBe(1);
    expect(result.userQuestionsObserved).toBe(1);
    const toolNames = appended
      .filter((event) => event.type === SessionEventType.ToolCallStarted)
      .map((event) => (event.payload as { toolName?: string }).toolName);
    expect(toolNames).toContain("muse-approval:Bash");
    expect(toolNames).toContain("muse-question");
  });

  it("maps reported token usage from the port and still records null cost (R6)", async () => {
    const controller = new AbortController();
    const port = {
      async runMuseExec(
        _request: import("@zcode/contracts").MuseExecRequest,
        handlers: ScriptedPortRun["handlers"],
      ) {
        await handlers.onEvent({ kind: "text_delta", text: "answer" });
        return {
          cancelled: false,
          exitCode: 0,
          stderrTail: "",
          timedOut: false,
          unknownEventCount: 0,
          surface: "session-protocol",
          museSessionId: "muse-session-42",
          resumedMuseSession: true,
          approvalRequestsObserved: 0,
          userQuestionsObserved: 0,
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            reasoningTokens: 5,
            cachedTokens: 8,
            cacheReadTokens: 6,
            cacheWriteTokens: 2,
          },
          approvalPosture: "fail-closed",
        } satisfies import("@zcode/contracts").MuseExecRunResult;
      },
    };
    const { persistedMessages, persistedParts, runtime } = createStubRuntime(port);
    const result = await runDelegatedMuseTurn.call(
      runtime,
      baseParams(runtime, controller.signal, []),
    );
    // 端口申报的 token 如实映射到 turn 结果；货币成本仍是 null（订阅计量无 USD 值）。
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 30 });
    expect(result.surface).toBe("session-protocol");
    expect(result.resumedMuseSession).toBe(true);
    expect(result.museSessionId).toBe("muse-session-42");
    const assistant = persistedMessages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.cost).toBeNull();
    expect(assistant?.tokens).toMatchObject({ input: 120, output: 30, reasoning: 5 });
    expect((assistant?.tokens as { cache?: { read?: number } }).cache?.read).toBe(6);
    const museMetadata = (
      assistant?.metadata as { museExecution?: { usageReporting?: string; surface?: string } }
    )?.museExecution;
    expect(museMetadata?.usageReporting).toBe("reported");
    expect(museMetadata?.surface).toBe("session-protocol");
    const stepFinish = persistedParts.find((part) => part.type === "step-finish");
    expect(stepFinish && stepFinish.type === "step-finish" ? stepFinish.cost : 0).toBeNull();
    expect(
      stepFinish && stepFinish.type === "step-finish"
        ? (stepFinish.tokens as { input?: number }).input
        : undefined,
    ).toBe(120);
  });
});
