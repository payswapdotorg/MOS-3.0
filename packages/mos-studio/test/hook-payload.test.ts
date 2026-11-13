import { describe, expect, test } from "vitest";
import { parseSessionStartHookPayload } from "../src/contract/hook-payload.js";
import { runSessionStartHook } from "../src/hook/main.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** SessionStart payload 解析（stdin JSON；camelCase 主契约 + snake_case 别名）。 */

const STARTUP_PAYLOAD = {
  hookEventName: "SessionStart",
  sessionId: "sess_abc123",
  cwd: "/home/z/project",
  timestamp: "2026-11-13T12:00:00.000Z",
  source: "startup",
  agentName: "main",
  mode: "default",
  traceId: "trace-1",
  session_id: "sess_abc123",
  hook_event_name: "SessionStart",
  transcript_path: "/tmp/transcript.jsonl",
};

describe("parseSessionStartHookPayload", () => {
  test("parses a real-shaped startup payload (aliases tolerated)", () => {
    const payload = parseSessionStartHookPayload(JSON.stringify(STARTUP_PAYLOAD));
    expect(payload).not.toBeNull();
    expect(payload?.sessionId).toBe("sess_abc123");
    expect(payload?.source).toBe("startup");
    expect(payload?.cwd).toBe("/home/z/project");
  });

  test("resume/fork/clear/compact are distinct sources (not new tasks)", () => {
    for (const source of ["resume", "fork", "clear", "compact"]) {
      const payload = parseSessionStartHookPayload(
        JSON.stringify({ ...STARTUP_PAYLOAD, source }),
      );
      expect(payload?.source).toBe(source);
    }
  });

  test("garbage input → null (fail-closed, no guessing)", () => {
    expect(parseSessionStartHookPayload("not json")).toBeNull();
    expect(parseSessionStartHookPayload("")).toBeNull();
  });

  test("missing required fields → null", () => {
    expect(parseSessionStartHookPayload(JSON.stringify({ hookEventName: "SessionStart" }))).toBeNull();
    expect(
      parseSessionStartHookPayload(JSON.stringify({ ...STARTUP_PAYLOAD, sessionId: "" })),
    ).toBeNull();
    expect(parseSessionStartHookPayload(JSON.stringify({ ...STARTUP_PAYLOAD, source: "other" }))).toBeNull();
  });
});

describe("runSessionStartHook outcomes (graceful failure)", () => {
  test("non-startup source is skipped without any write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mos-studio-hook-"));
    const outcome = await runSessionStartHook(
      JSON.stringify({ ...STARTUP_PAYLOAD, source: "resume" }),
      { dataDir: directory },
    );
    expect(outcome.outcome).toBe("skipped");
    expect(outcome.sessionId).toBe("sess_abc123");
  });

  test("unparseable payload is skipped", async () => {
    const outcome = await runSessionStartHook("{oops", {});
    expect(outcome.outcome).toBe("skipped");
    expect(outcome.sessionId).toBeNull();
  });

  test("missing ZCODE_PLUGIN_DATA settles as sidecar_error (graceful, never throws)", async () => {
    const outcome = await runSessionStartHook(JSON.stringify(STARTUP_PAYLOAD), {
      dataDir: null,
    });
    expect(outcome.outcome).toBe("sidecar_error");
  });
});
