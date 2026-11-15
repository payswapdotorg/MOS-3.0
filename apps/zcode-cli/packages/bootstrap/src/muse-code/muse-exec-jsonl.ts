import type { MuseExecStreamEvent } from "@zcode/contracts";
// `muse exec --json` JSONL 事件映射（Issue #24 / ACR-0002；PR #27 评审修订）。
//
// 纪律（AGENTS.md「do not invent CLI flags」同源约束）：
// - 这里只做「宽容映射 + 计数」，绝不猜测未映射事件的语义；未知/无法解析的行
//   计入 unknownEventCount，供在机验证（spec/integrations/provider-evidence/
//   muse-code-connector-evidence.md）对账后更新映射表。
// - 映射表版本化：真实 CLI 的事件 schema 变化时递增 MUSE_EXEC_JSONL_MAPPING_VERSION
//   （v2：PR #27 评审 R2/R3——候选 session-id 捕获 + 审批/提问事件映射）。
// - 摘要截断上限固定，避免工具输出大块内容进入会话事件正文。

/** 映射表版本；在机验证更新映射时递增并记录证据。 */
export const MUSE_EXEC_JSONL_MAPPING_VERSION = 2;

/** 工具活动摘要/错误信息的截断上限。 */
const SUMMARY_MAX_CHARS = 2000;

export type ParsedMuseExecLine =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "unknown"; type?: string; museSessionId?: string }
  | {
      status: "event";
      event: MuseExecStreamEvent;
      /** 信封级候选 session id（R2）：捕获后由进程层持久化；绝不虚构。 */
      museSessionId?: string;
    };

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
// 审批请求候选事件名（PR #27 评审 R3）：真实 schema 未观测，映射按候选名宽容
// 匹配；未命中计入 unknown（不猜测）。
const APPROVAL_REQUIRED_TYPES = new Set([
  "approval_required",
  "approval_request",
  "approval_requested",
  "permission_request",
]);
// 用户提问候选事件名（agent 向用户提问；headless 轮如实投影，不代答）。
const USER_QUESTION_TYPES = new Set(["user_question", "question", "user_input_request"]);

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
  // 信封级候选 session id 捕获（R2）：任意事件行都可能携带（含未知类型行——
  // 例如 session_started/session_resumed 申报），同值幂等。
  const museSessionId = readMuseSessionId(record);
  if (!type) return { status: "unknown", ...(museSessionId ? { museSessionId } : {}) };

  if (TEXT_DELTA_TYPES.has(type)) {
    const text = readString(record, ["text", "delta", "content"]);
    if (text === undefined) return { status: "unknown", type };
    return { status: "event", event: { kind: "text_delta", text }, ...(museSessionId ? { museSessionId } : {}) };
  }
  if (TEXT_END_TYPES.has(type)) {
    return { status: "event", event: { kind: "text_end" }, ...(museSessionId ? { museSessionId } : {}) };
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
      ...(museSessionId ? { museSessionId } : {}),
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
      ...(museSessionId ? { museSessionId } : {}),
    };
  }
  if (ERROR_TYPES.has(type)) {
    const message =
      readString(record, ["message", "error"]) ?? `Muse CLI reported ${type}`;
    const code = readString(record, ["code"]);
    return {
      status: "event",
      event: { kind: "error", message: truncate(message), ...(code ? { code } : {}) },
      ...(museSessionId ? { museSessionId } : {}),
    };
  }
  if (APPROVAL_REQUIRED_TYPES.has(type)) {
    const toolName = readString(record, ["toolName", "tool", "name"]);
    const summary = readSummary(record, ["message", "prompt", "summary", "detail"]);
    return {
      status: "event",
      event: {
        kind: "approval_required",
        ...(toolName ? { toolName } : {}),
        ...(summary !== undefined ? { summary } : {}),
      },
      ...(museSessionId ? { museSessionId } : {}),
    };
  }
  if (USER_QUESTION_TYPES.has(type)) {
    const question = readSummary(record, ["question", "text", "message", "prompt"]);
    if (question === undefined) return { status: "unknown", type };
    return {
      status: "event",
      event: { kind: "user_question", summary: question },
      ...(museSessionId ? { museSessionId } : {}),
    };
  }
  return { status: "unknown", type, ...(museSessionId ? { museSessionId } : {}) };
}

/** 信封级候选 session id（session_id / sessionId / session.id）；宽读不猜测。 */
function readMuseSessionId(record: Record<string, unknown>): string | undefined {
  const direct = readString(record, ["session_id", "sessionId"]);
  if (direct) return direct;
  const session = record.session;
  if (session !== null && typeof session === "object" && !Array.isArray(session)) {
    const nested = readString(session as Record<string, unknown>, ["id", "session_id", "sessionId"]);
    if (nested) return nested;
  }
  return undefined;
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
