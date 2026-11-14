/**
 * MuseSessionModelAdapter 执行器契约测试（ACR-0002）。
 * 通过注入脚本化 SDK 假对象驱动完整回合：启动会话、提交回合、三路泵取、
 * 中止（interrupt + 立即抛出）、失败回合（ModelProtocolError）、宿主死亡重置。
 * 这些是 contract tests：不启动真实 `muse` 二进制（真实端到端见
 * docs/model-provider-muse-cli.md 的 Windows 验证流程）。
 */

import { describe, expect, it } from "vitest";
import { ModelProtocolError } from "@zcode/contracts";
import type { ModelEvent } from "@zcode/contracts";
import type { ModelConfig, RegistryProviderConfig } from "@zcode/provider";
import { MuseSessionModelAdapter } from "../../src/model/muse/muse-session-model.js";
import type { MuseClientFactory } from "../../src/model/muse/muse-host.js";

interface ScriptedTurn {
  items: unknown[];
  deltas: unknown[];
  outcome: { kind: "completed"; params: unknown } | { kind: "unqueued"; params: unknown } | { kind: "terminalUnknown" };
}

function museProviderConfig(): RegistryProviderConfig {
  return {
    group: "standard-personal",
    access: { type: "muse-cli-local" },
    api: { type: "muse-session-protocol" },
  } as unknown as RegistryProviderConfig;
}

function museModelConfig(): ModelConfig {
  return {
    enabled: true,
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: 1_000_000,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    },
    optionSpecs: {
      maxOutputTokens: { max: 64_000, map: "{}" },
      reasoningLevel: { values: ["none", "high"], map: "{}" },
    },
  } as unknown as ModelConfig;
}

function fakeClient(script: {
  sessions: ScriptedTurn[];
  startSessionCalls?: { workspaceRoot?: string; modelId?: string }[];
}) {
  const startSessionCalls = script.startSessionCalls ?? [];
  let sessionIndex = 0;
  const client = {
    async startSession(options: { workspaceRoot?: string; modelId?: string } = {}) {
      startSessionCalls.push(options);
      return session();
    },
    async close() {},
  };
  function session() {
    const turn = script.sessions[Math.min(sessionIndex, script.sessions.length - 1)]!;
    sessionIndex += 1;
    return {
      onApproval() {},
      onApprovalError() {},
      async sendUserTurn() {
        return turnObject(turn);
      },
      async leave() {},
    };
  }
  function turnObject(turn: ScriptedTurn) {
    let itemQueue = [...turn.items];
    let deltaQueue = [...turn.deltas];
    let interrupted = false;
    return {
      async interrupt() {
        interrupted = true;
      },
      get interrupted() {
        return interrupted;
      },
      items() {
        return (async function* () {
          while (itemQueue.length > 0) {
            yield itemQueue.shift();
          }
        })();
      },
      deltas() {
        return (async function* () {
          while (deltaQueue.length > 0) {
            yield deltaQueue.shift();
          }
        })();
      },
      completed: (async () => turn.outcome)(),
    };
  }
  return { client, startSessionCalls };
}

function adapterWith(script: Parameters<typeof fakeClient>[0], env?: Record<string, string>) {
  const { client, startSessionCalls } = fakeClient(script);
  const clientFactory: MuseClientFactory = async () => client as never;
  const adapter = new MuseSessionModelAdapter({
    workspaceRoot: "/workspace/project",
    appVersion: "0.0.0-test",
    env,
    clientFactory,
  });
  return { adapter, startSessionCalls };
}

function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const collected: ModelEvent[] = [];
  return (async () => {
    for await (const event of events) collected.push(event);
    return collected;
  })();
}

function baseRequest(overrides: { abortSignal?: AbortSignal } = {}) {
  return {
    messages: [{ role: "user", content: "summarize the repo" }],
    options: { reasoningLevel: "high", maxOutputTokens: 512 },
    ...overrides,
  };
}

describe("MuseSessionModelAdapter.createModel", () => {
  it("produces a Model bound to the registry selection", async () => {
    const { adapter } = adapterWith({ sessions: [] });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3-contributor",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    expect(String(model.providerId)).toBe("muse-code-cli");
    expect(String(model.modelId)).toBe("muse-spark-1.3-contributor");
    expect([...model.optionSpecs.reasoningLevel.values]).toEqual(["none", "high"]);
  });

  it("rejects non-muse provider configs (fail-closed)", () => {
    const { adapter } = adapterWith({ sessions: [] });
    expect(() =>
      adapter.createModel({
        providerId: "x",
        modelId: "y",
        providerConfig: { api: { type: "openai-chat-completions", baseUrl: "https://x" } } as never,
        modelConfig: museModelConfig(),
      }),
    ).toThrow(ModelProtocolError);
  });
});

describe("streamText 回合", () => {
  it("streams text deltas and finish with mapped usage; session binds workspace + model", async () => {
    const { adapter, startSessionCalls } = adapterWith({
      sessions: [
        {
          items: [
            { itemId: "i1", kind: "agentMessage", revision: 1, status: "inProgress" },
            { itemId: "i1", kind: "agentMessage", revision: 2, status: "completed", text: "hello" },
          ],
          deltas: [{ itemId: "i1", delta: "hello" }],
          outcome: {
            kind: "completed",
            params: {
              terminal: "completed",
              usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 },
            },
          },
        },
      ],
    });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3-contributor",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    const events = await collect(model.streamText(baseRequest()));
    expect(events.map((event) => event.type)).toEqual([
      "text_start",
      "text_delta",
      "text_end",
      "finish",
    ]);
    const finish = events.at(-1);
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, totalTokens: 15 },
    });
    expect(startSessionCalls[0]).toMatchObject({
      workspaceRoot: "/workspace/project",
      modelId: "muse-spark-1.3-contributor",
    });
  });

  it("maps a failed terminal to ModelProtocolError (AI SDK 同语义)", async () => {
    const { adapter } = adapterWith({
      sessions: [
        {
          items: [{ itemId: "i1", kind: "agentMessage", revision: 1, status: "inProgress" }],
          deltas: [],
          outcome: {
            kind: "completed",
            params: { terminal: "failed", error: { kind: "launchError", message: "not logged in" } },
          },
        },
      ],
    });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    await expect(collect(model.streamText(baseRequest()))).rejects.toThrow(ModelProtocolError);
  });

  it("aborts by interrupting the turn and throwing the abort reason", async () => {
    let observedInterrupt = false;
    const controller = new AbortController();
    const clientFactory: MuseClientFactory = async () =>
      ({
        async startSession() {
          return {
            onApproval() {},
            onApprovalError() {},
            async sendUserTurn() {
              return {
                async interrupt() {
                  observedInterrupt = true;
                },
                items() {
                  return (async function* () {
                    // 挂起等待：中止信号到来前不结束
                    await new Promise(() => undefined);
                  })();
                },
                deltas() {
                  return (async function* () {
                    yield { itemId: "i1", delta: "partial" };
                    await new Promise(() => undefined);
                  })();
                },
                completed: new Promise(() => undefined),
              };
            },
            async leave() {},
          };
        },
        async close() {},
      }) as never;
    const adapter = new MuseSessionModelAdapter({
      workspaceRoot: "/w",
      appVersion: "0",
      clientFactory,
    });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    const collection = collect(model.streamText(baseRequest({ abortSignal: controller.signal })));
    // 让 pump 进入等待后触发中止
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new Error("v4 session stopped"));
    await expect(collection).rejects.toThrow("v4 session stopped");
    expect(observedInterrupt).toBe(true);
  });
});

describe("generateText 回合", () => {
  it("accumulates text and returns usage/finishReason", async () => {
    const { adapter } = adapterWith({
      sessions: [
        {
          items: [
            { itemId: "i1", kind: "agentMessage", revision: 1, status: "inProgress" },
            { itemId: "i1", kind: "agentMessage", revision: 2, status: "completed", text: "a b" },
          ],
          deltas: [
            { itemId: "i1", delta: "a " },
            { itemId: "i1", delta: "b" },
          ],
          outcome: {
            kind: "completed",
            params: { terminal: "completed", usage: { inputTokens: 3, outputTokens: 2 } },
          },
        },
      ],
    });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    const result = await model.generateText(baseRequest());
    expect(result.text).toBe("a b");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  });
});

describe("host 启动失败归一", () => {
  it("wraps spawn failure into ModelProtocolError with actionable message", async () => {
    const clientFactory: MuseClientFactory = async () => {
      throw Object.assign(new Error("spawn failed"), {
        failure: { kind: "spawnFailed" },
        stderrTail: [],
      });
    };
    const adapter = new MuseSessionModelAdapter({
      workspaceRoot: "/w",
      appVersion: "0",
      clientFactory,
    });
    const model = adapter.createModel({
      providerId: "muse-code-cli",
      modelId: "muse-spark-1.3",
      providerConfig: museProviderConfig(),
      modelConfig: museModelConfig(),
      options: { reasoningLevel: "high" },
    });
    await expect(collect(model.streamText(baseRequest()))).rejects.toThrow(
      /Muse Code CLI host failed to start \(spawnFailed\)/,
    );
  });
});
