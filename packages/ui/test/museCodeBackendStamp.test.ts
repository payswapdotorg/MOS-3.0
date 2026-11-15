import { describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  getMuseCodeBackendState,
  setMuseCodeBackendEnabled,
  setMuseCodeBackendSupported,
} from "@/v4/museCodeBackendState.js";
// 信封携带 executionBackend 的双门控契约（Issue #24 / ACR-0002）：
// 只有「用户意图 enabled + 本会话 CLI 能力 supported」同时成立时，createSession /
// sendText 信封才携带 executionBackend: "muse-code"；其余命令永不携带；任一门
// 未开都不得携带（旧 CLI 会静默剥掉该字段并退回普通模型执行——静默改道）。

function envelopeOf(type: "createSession" | "sendText" | "stop"): CommandEnvelope {
  return createCommandEnvelope({
    type,
    sessionId: type === "createSession" ? null : "sess_fixture",
    payload:
      type === "createSession"
        ? { workspaceId: "ws_fixture" }
        : type === "sendText"
          ? { text: "hello" }
          : {},
  } as never);
}

describe("muse code execution backend envelope stamping", () => {
  it("stamps createSession and sendText only when both gates are open", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(true);
    expect(envelopeOf("createSession").executionBackend).toBe("muse-code");
    expect(envelopeOf("sendText").executionBackend).toBe("muse-code");
    expect(envelopeOf("stop").executionBackend).toBeUndefined();
  });

  it("never stamps when the user intent is disabled", () => {
    setMuseCodeBackendEnabled(false);
    setMuseCodeBackendSupported(true);
    expect(envelopeOf("sendText").executionBackend).toBeUndefined();
  });

  it("never stamps when the session capability was not confirmed", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(false);
    expect(envelopeOf("sendText").executionBackend).toBeUndefined();
    expect(getMuseCodeBackendState()).toEqual({ enabled: true, supported: false });
  });
});
