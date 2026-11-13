import { describe, expect, test } from "vitest";
import { sessionFactsFromToolCallMeta } from "../src/contract/session-context.js";
import { studioSessionContextFromMeta } from "../src/application/studio-service.js";

/** tools/call `_meta` 会话事实提取（模型与面板调用都会注入；缺失即缺失）。 */

const META = {
  session_id: "sess_meta_1",
  workspace_path: "/home/z/project",
  workspace_identity: null,
  workspace_key: "/home/z/project",
  trace_id: "trace-9",
  turn_id: "turn-1",
};

describe("sessionFactsFromToolCallMeta", () => {
  test("extracts facts from a real-shaped _meta", () => {
    const meta = sessionFactsFromToolCallMeta(META);
    expect(meta?.session_id).toBe("sess_meta_1");
    expect(meta?.workspace_key).toBe("/home/z/project");
  });

  test("reads the com.zcode/request-context mirror when present", () => {
    const meta = sessionFactsFromToolCallMeta({
      "com.zcode/request-context": { session_id: "sess_mirror", workspace_path: "/w" },
    });
    expect(meta?.session_id).toBe("sess_mirror");
    expect(meta?.workspace_path).toBe("/w");
  });

  test("null on absent/garbage meta (fail-closed)", () => {
    expect(sessionFactsFromToolCallMeta(null)).toBeNull();
    expect(sessionFactsFromToolCallMeta(undefined)).toBeNull();
    expect(sessionFactsFromToolCallMeta("nope")).toBeNull();
    expect(sessionFactsFromToolCallMeta(42)).toBeNull();
  });

  test("partial meta keeps only observed fields", () => {
    const meta = sessionFactsFromToolCallMeta({ workspace_key: "/w" });
    expect(meta?.workspace_key).toBe("/w");
    expect(meta?.session_id).toBeUndefined();
  });
});

describe("studioSessionContextFromMeta", () => {
  test("full meta → full context", () => {
    const context = studioSessionContextFromMeta(sessionFactsFromToolCallMeta(META));
    expect(context.sessionId).toBe("sess_meta_1");
    expect(context.workspacePath).toBe("/home/z/project");
    expect(context.workspaceIdentity).toBeNull();
  });

  test("no meta → null-field context (never invented)", () => {
    const context = studioSessionContextFromMeta(null);
    expect(context.sessionId).toBeNull();
    expect(context.workspacePath).toBeNull();
    expect(context.workspaceKey).toBeNull();
    expect(context.workspaceIdentity).toBeNull();
  });
});
