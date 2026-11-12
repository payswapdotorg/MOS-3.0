import type { ClassifiedProviderError, ProviderErrorKind } from "../contract/provider-errors.js";
import type { ProviderContentBlock, ProviderServerState } from "../contract/provider-port.js";

/**
 * Provider 错误分类（负向矩阵）：把 provider 工具调用失败映射到公共错误语言。
 * 规则：
 * - 只有命中已知模式才赋具体 kind；其余一律 unknown（fail-closed）。
 * - message 走 redact()，只保留安全骨架。
 * - retryable 只对限速/瞬时故障为 true；unauthorized 永不重试（需重新授权）。
 */

const PATTERNS: ReadonlyArray<{ kind: ProviderErrorKind; retryable: boolean; match: RegExp }> = [
  { kind: "unauthorized", retryable: false, match: /\b(401|unauthorized|invalid_grant|expired[_ -]?token|revoked[_ -]?(token|credential)|re-?auth)\b/i },
  { kind: "insufficient_scope", retryable: false, match: /\b(403|insufficient[_ -]?(scope|permission)|missing[_ -]?scope|not[_ -]?granted)\b/i },
  { kind: "wrong_account", retryable: false, match: /\b(wrong[_ -]?(account|portal|tenant)|account[_ -]?mismatch|portal[_ -]?not[_ -]?found)\b/i },
  { kind: "rate_limited", retryable: true, match: /\b(429|rate[_ -]?limit|too[_ -]?many[_ -]?requests|quota[_ -]?exceeded)\b/i },
  { kind: "provider_outage", retryable: true, match: /\b(5\d\d|internal[_ -]?server[_ -]?error|service[_ -]?unavailable|bad[_ -]?gateway|gateway[_ -]?timeout|upstream)\b/i },
  { kind: "tool_not_found", retryable: false, match: /\b(tool[_ -]?not[_ -]?found|unknown[_ -]?tool|method[_ -]?not[_ -]?found)\b/i },
  { kind: "invalid_input", retryable: false, match: /\b(invalid[_ -]?(input|argument|parameter|request[_ -]?payload)|schema[_ -]?validation)\b/i },
  { kind: "protocol_error", retryable: false, match: /\b(protocol[_ -]?(error|version)|handshake|unsupported[_ -]?version)\b/i },
];

/** 脱敏：截断 + 去掉疑似令牌片段；保留可诊断的骨架文本。 */
export function redactProviderMessage(raw: string): string {
  const stripped = raw.replace(/(eyJ|sk-|Bearer\s|gh[pousr]_)[A-Za-z0-9._+/=-]{6,}/g, "[redacted]");
  return stripped.length > 240 ? `${stripped.slice(0, 240)}…` : stripped;
}

export function classifyProviderError(
  failure: {
    message?: string;
    httpStatus?: number | null;
    content?: readonly ProviderContentBlock[];
  },
  serverState?: ProviderServerState | null,
): ClassifiedProviderError {
  const parts: string[] = [];
  if (failure.message) parts.push(failure.message);
  for (const block of failure.content ?? []) {
    if (typeof block.text === "string") parts.push(block.text);
  }
  const message = redactProviderMessage(parts.join(" ") || serverState?.error || "provider error");

  for (const pattern of PATTERNS) {
    if (pattern.match.test(message)) {
      return { kind: pattern.kind, message, retryable: pattern.retryable, httpStatusHint: failure.httpStatus ?? null };
    }
  }
  if (typeof failure.httpStatus === "number") {
    const status = failure.httpStatus;
    const mapped: ProviderErrorKind | null =
      status === 401 ? "unauthorized"
      : status === 403 ? "insufficient_scope"
      : status === 429 ? "rate_limited"
      : status >= 500 ? "provider_outage"
      : null;
    if (mapped) {
      const retryable = mapped === "rate_limited" || mapped === "provider_outage";
      return { kind: mapped, message, retryable, httpStatusHint: status };
    }
  }
  return { kind: "unknown", message, retryable: false, httpStatusHint: failure.httpStatus ?? null };
}

/** scope 覆盖检查：精确集合差；要求的 scope 必须逐项被授予（无通配符）。 */
export function missingScopes(
  required: readonly string[],
  granted: readonly string[],
): string[] {
  const grantedSet = new Set(granted);
  return required.filter((scope) => !grantedSet.has(scope));
}
