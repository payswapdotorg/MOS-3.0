import { afterEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  getMuseCodeBackendState,
  isMuseDelegatedSelectionActive,
  setMuseCodeBackendEnabled,
  setMuseCodeBackendSupported,
} from "@/v4/museCodeBackendState.js";
// 信封携带 executionBackend 的门控契约（Issue #24 / ACR-0002；MC-D 按选型路由）：
// 「用户意图 enabled + 本会话 CLI 能力 supported」双门控成立 **且** 本轮提交选型
// 命中 Muse delegated 模型家族（shared isMuseDelegatedModelSelection）时，
// createSession.firstInput / sendText 信封才携带 executionBackend: "muse-code"；
// 普通模型选型/缺选型/其余命令/任一门未开都不得携带（旧 CLI 会静默剥掉该字段并
// 退回普通模型执行——静默改道）。CLI 侧对会话常驻选型做同一判定（Studio/续发
// 场景覆盖），这里验证 renderer 侧显式携带语义。

afterEach(() => {
  setMuseCodeBackendEnabled(false);
  setMuseCodeBackendSupported(false);
});

function envelopeOf(
  type: "createSession" | "sendText" | "stop",
  payload?: Record<string, unknown>,
): CommandEnvelope {
  return createCommandEnvelope({
    type,
    sessionId: type === "createSession" ? null : "sess_fixture",
    payload:
      payload ??
      (type === "createSession"
        ? { workspaceId: "ws_fixture" }
        : type === "sendText"
          ? { text: "hello" }
          : {}),
  } as never);
}

const CONTRIBUTOR_SELECTION = { providerId: "meta", modelId: "muse-spark-1.3-contributor" };
const FREE_ZEN_SELECTION = {
  providerId: "opencode-zen-chat",
  modelId: "muse-spark-1.2-contributor-free",
};
const ORDINARY_SELECTION = { providerId: "openrouter", modelId: "glm-5.3" };

describe("muse code execution backend envelope stamping (model-selection routed)", () => {
  it("stamps createSession.firstInput and sendText when both gates are open and the submitted selection is a Muse delegated model", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(true);
    expect(
      envelopeOf("createSession", {
        workspaceId: "ws_fixture",
        firstInput: { text: "hello", modelSelection: CONTRIBUTOR_SELECTION },
      }).executionBackend,
    ).toBe("muse-code");
    expect(
      envelopeOf("sendText", { text: "hello", modelSelection: CONTRIBUTOR_SELECTION })
        .executionBackend,
    ).toBe("muse-code");
    expect(
      envelopeOf("stop", { text: "hello", modelSelection: CONTRIBUTOR_SELECTION })
        .executionBackend,
    ).toBeUndefined();
  });

  it("never stamps for ordinary model selections (no silent rerouting; the selector stays genuinely usable)", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(true);
    expect(
      envelopeOf("sendText", { text: "hello", modelSelection: ORDINARY_SELECTION })
        .executionBackend,
    ).toBeUndefined();
    // OpenCode Zen 免费变体是显式免费 HTTP 选型，绝不改道到 CLI 订阅。
    expect(
      envelopeOf("sendText", { text: "hello", modelSelection: FREE_ZEN_SELECTION })
        .executionBackend,
    ).toBeUndefined();
    expect(
      envelopeOf("createSession", {
        workspaceId: "ws_fixture",
        firstInput: { text: "hello", modelSelection: FREE_ZEN_SELECTION },
      }).executionBackend,
    ).toBeUndefined();
  });

  it("does not stamp when the payload carries no selection (CLI-side rule covers standing selections)", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(true);
    expect(envelopeOf("sendText").executionBackend).toBeUndefined();
    expect(envelopeOf("createSession").executionBackend).toBeUndefined();
  });

  it("never stamps when the user intent is disabled", () => {
    setMuseCodeBackendEnabled(false);
    setMuseCodeBackendSupported(true);
    expect(
      envelopeOf("sendText", { text: "hello", modelSelection: CONTRIBUTOR_SELECTION })
        .executionBackend,
    ).toBeUndefined();
  });

  it("never stamps when the session capability was not confirmed", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(false);
    expect(
      envelopeOf("sendText", { text: "hello", modelSelection: CONTRIBUTOR_SELECTION })
        .executionBackend,
    ).toBeUndefined();
    expect(getMuseCodeBackendState()).toEqual({ enabled: true, supported: false });
  });

  it("isMuseDelegatedSelectionActive mirrors the routing rule for the composer indicator", () => {
    setMuseCodeBackendEnabled(true);
    setMuseCodeBackendSupported(true);
    expect(isMuseDelegatedSelectionActive(CONTRIBUTOR_SELECTION)).toBe(true);
    expect(isMuseDelegatedSelectionActive(ORDINARY_SELECTION)).toBe(false);
    expect(isMuseDelegatedSelectionActive(FREE_ZEN_SELECTION)).toBe(false);
    expect(isMuseDelegatedSelectionActive(undefined)).toBe(false);
    setMuseCodeBackendEnabled(false);
    expect(isMuseDelegatedSelectionActive(CONTRIBUTOR_SELECTION)).toBe(false);
  });
});
