import type { MuseExecStreamEvent } from "@zcode/contracts";
// `muse exec --json` JSONL 事件映射（Issue #24 / ACR-0002）。
//
// 纪律（AGENTS.md「do not invent CLI flags」同源约束）：
// - 这里只做「宽容映射 + 计数」，绝不猜测未映射事件的语义；未知/无法解析的行
//   计入 unknownEventCount，供在机验证（spec/integrations/provider-evidence/
//   muse-code-connector-evidence.md）对账后更新映射表。
// - 映射表版本化：真实 CLI 的事件 schema 变化时递增 MUSE_EXEC_JSONL_MAPPING_VERSION。
// - 摘要截断上限固定，避免工具输出大块内容进入会话事件。

/** 映射表版本；在机验证更新映射时递增并记录证据。 */
export const MUSE_EXEC_JSONL_MAPPING_VERSION = 1;

/** 工具活动摘要/错误信息的截断上限。 */
const SUMMARY_MAX_CHARS = 2000;

export type ParsedMuseExecLine =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "unknown"; type?: string }
  | { status: "event"; event: MuseExecStreamEvent };

const TEXT_DELTA_TYPES = new Set(["assistant_text_delta", "text_delta"]);
const TEXT_END_TYPES = new Set(["assistant_text_end", "text_end"]);
const TOOL_STARTED_TYPES = new Set([
  "tool_call",
  "tool_call_started",
  "tool_started",
  "tool_use",
]);
const TOOL_DONE_TYPES = new Set([
  "tool_result",
  "tool_call_result",
  "tool_completed",
  "tool_use_result",
]);
const ERROR_TYPES = new Set(["error", "assistant_error", "turn_error"]);

export function parseMuseExecJsonlLine(line: string): ParsedMuseExecLine {
  const trimmed = line.trim();
  if (!trimmed) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { status: "invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "unknown" };
  }
  const record = parsed as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (!type) return { status: "unknown" };

  if (TEXT_DELTA_TYPES.has(type)) {
    const text = readString(record, ["text", "delta", "content"]);
    if (text === undefined) return { status: "unknown", type };
    return { status: "event", event: { kind: "text_delta", text } };
  }
  if (TEXT_END_TYPES.has(type)) {
    return { status: "event", event: { kind: "text_end" } };
  }
  if (TOOL_STARTED_TYPES.has(type)) {
    const toolName = readString(record, ["toolName", "tool", "name"]);
    if (toolName === undefined) return { status: "unknown", type };
    return {
      status: "event",
      event: {
        kind: "tool_activity",
        status: "started",
        toolCallId: readToolCallId(record) ?? "",
        toolName,
        ...(typeof record.startedAt === "number" ? { startedAt: record.startedAt } : {}),
      },
    };
  }
  if (TOOL_DONE_TYPES.has(type)) {
    const toolName = readString(record, ["toolName", "tool", "name"]) ?? "tool";
    const rawStatus = readString(record, ["status"]);
    const summary = readSummary(record, ["summary", "result", "output", "content"]);
    return {
      status: "event",
      event: {
        kind: "tool_activity",
        status: rawStatus === "error" ? "error" : "completed",
        toolCallId: readToolCallId(record) ?? "",
        toolName,
        ...(summary !== undefined ? { summary } : {}),
        ...(typeof record.durationMs === "number" ? { durationMs: record.durationMs } : {}),
      },
    };
  }
  if (ERROR_TYPES.has(type)) {
    const message =
      readString(record, ["message", "error"]) ?? `Muse CLI reported ${type}`;
    const code = readString(record, ["code"]);
    return {
      status: "event",
      event: { kind: "error", message: truncate(message), ...(code ? { code } : {}) },
    };
  }
  return { status: "unknown", type };
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readToolCallId(record: Record<string, unknown>): string | undefined {
  return readString(record, ["toolCallId", "tool_call_id", "callId", "id", "toolUseId"]);
}

function readSummary(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return truncate(value);
    if (value !== null && typeof value === "object") {
      try {
        return truncate(JSON.stringify(value));
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > SUMMARY_MAX_CHARS ? `${value.slice(0, SUMMARY_MAX_CHARS)}…` : value;
}
