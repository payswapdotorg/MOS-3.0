/**
 * MOS ModelRequest → Muse turn 输入的映射。
 *
 * 设计（ACR-0002）：每次模型请求都开启一个全新的 MSP session（无状态回合），
 * 对话连续性通过渲染历史转录实现。这样 MOS 的 rewind / retry / 换模型不受
 * 外部会话状态牵连，也不需要在 Adapter 层维护 MOS↔Muse 的会话映射。
 */

import { ModelErrorCode, ModelProtocolError } from "@zcode/contracts";
import type { ModelExecutionRequest } from "../model.js";
import type { ModelInputMessage } from "@zcode/contracts";

/** Muse reasoning-effort 档位（CLI `--reasoning-effort` 的封闭词表）。 */
export const MUSE_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type MuseReasoningEffort = (typeof MUSE_REASONING_EFFORTS)[number];

const DEFAULT_MUSE_REASONING_EFFORT: MuseReasoningEffort = "high";

/** Muse Code 自身的默认档位是 high（`muse model-profile` 实测），与 CLI 行为对齐。 */
export function toMuseReasoningEffort(reasoningLevel: string | undefined): MuseReasoningEffort {
  if (reasoningLevel === undefined) return DEFAULT_MUSE_REASONING_EFFORT;
  const normalized = reasoningLevel.trim().toLowerCase();
  return (MUSE_REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as MuseReasoningEffort)
    : DEFAULT_MUSE_REASONING_EFFORT;
}

/** 历史转录上限（字符）：保留最近的部分，更早的截断。 */
const MAX_HISTORY_CHARS = 60_000;
const TRUNCATION_NOTICE = "…(earlier conversation truncated)\n";

/**
 * 渲染提交给 Muse 的回合输入文本。
 *
 * - 单条用户消息（New Task 首轮的常态）：原文直传，Muse 行为与 CLI 一致。
 * - 多轮：先渲染 “更早对话” 转录（User/Assistant/工具结果），再给出当前请求。
 * - 系统消息被有意丢弃：Muse Code 携带自己的 agent 系统提示与工作区上下文，
 *   ZCode 的系统提示对它是噪声（ACR-0002 有记录）。
 */
export function renderMuseTurnPrompt(request: ModelExecutionRequest): string {
  const messages = request.messages;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) {
    throw new ModelProtocolError(ModelErrorCode.InvalidModelRequest, "Muse turn requires a user message", {
      messageCount: messages.length,
    });
  }
  const currentText = extractText(messages[lastUserIndex]);
  if (currentText.trim().length === 0) {
    throw new ModelProtocolError(ModelErrorCode.InvalidModelRequest, "Muse turn requires non-empty user input");
  }
  const history = messages.slice(0, lastUserIndex).filter((message) => message.role !== "system");
  if (history.length === 0) {
    return currentText;
  }
  const transcript = renderTranscript(history);
  return `[Earlier conversation in this MOS task]\n${transcript}\n\n[Current request]\n${currentText}`;
}

function renderTranscript(history: readonly ModelInputMessage[]): string {
  const lines: string[] = [];
  for (const message of history) {
    const text = extractText(message);
    if (text.trim().length === 0) continue;
    if (message.role === "user") {
      lines.push(`User: ${text}`);
    } else if (message.role === "assistant") {
      lines.push(`Assistant: ${text}`);
    } else if (message.role === "tool") {
      const name = message.toolName ?? "tool";
      lines.push(`[Tool result (${name})]: ${truncate(text, 2_000)}`);
    }
  }
  let rendered = lines.join("\n\n");
  if (rendered.length > MAX_HISTORY_CHARS) {
    rendered = TRUNCATION_NOTICE + rendered.slice(rendered.length - MAX_HISTORY_CHARS);
  }
  return rendered;
}

function extractText(message: ModelInputMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
