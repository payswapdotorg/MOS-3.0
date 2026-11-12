/**
 * Provider 错误分类契约：负向矩阵（no-scope / expired / 错账号 / 限速）的公共语言。
 * 分类必须 fail-closed：无法识别的错误一律 unknown，绝不冒充可重试或可忽略。
 */

export type ProviderErrorKind =
  | "unauthorized"
  | "insufficient_scope"
  | "wrong_account"
  | "rate_limited"
  | "provider_outage"
  | "tool_not_found"
  | "invalid_input"
  | "protocol_error"
  | "unknown";

export interface ClassifiedProviderError {
  readonly kind: ProviderErrorKind;
  /** 已脱敏的说明文本：绝不包含令牌、原始头或个人数据。 */
  readonly message: string;
  readonly retryable: boolean;
  /** 数字状态码提示（仅当原始来源确实是数字时携带）。 */
  readonly httpStatusHint: number | null;
}

/** 能力失效时应采取的动作（quality_gates：revoked_auth → invalidate_instance）。 */
export type ProviderErrorAction =
  | "invalidate_instance"
  | "backoff_and_surface"
  | "fail_closed";

export function providerErrorAction(kind: ProviderErrorKind): ProviderErrorAction {
  switch (kind) {
    case "unauthorized":
    case "insufficient_scope":
    case "wrong_account":
      return "invalidate_instance";
    case "rate_limited":
    case "provider_outage":
      return "backoff_and_surface";
    default:
      return "fail_closed";
  }
}
