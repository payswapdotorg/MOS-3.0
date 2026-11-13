import { z } from "zod";

/**
 * ZCode SessionStart hook 的 stdin payload 镜像（camelCase 主契约 + snake_case 兼容别名；
 * 依据 apps/zcode-cli/packages/contracts/src/hooks/index.ts 与
 * core/src/hooks/configured-runner-input.ts 的实际投递形状）。
 * 只解析本组合根消费的字段；其余字段原样忽略（无损）。
 */

const sessionId = z.string().min(1).max(256);
const nonBlankString = z.string().min(1);

export const sessionStartHookPayloadSchema = z
  .object({
    hookEventName: z.literal("SessionStart"),
    sessionId,
    cwd: nonBlankString,
    timestamp: nonBlankString,
    source: z.enum(["startup", "resume", "fork", "clear", "compact"]),
    // 兼容别名（configured-runner-input 同时投递两套键名）
    hook_event_name: z.literal("SessionStart").optional(),
    session_id: sessionId.optional(),
  });

export type SessionStartHookPayload = z.infer<typeof sessionStartHookPayloadSchema>;

/** 解析失败 = 事实不足 → 调用方 fail-closed（不猜测、不默认）。 */
export function parseSessionStartHookPayload(raw: string): SessionStartHookPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = sessionStartHookPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
