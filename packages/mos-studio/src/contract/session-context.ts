import { z } from "zod";

/**
 * ZCode tools/call 请求 `_meta` 的会话事实镜像（依据
 * apps/zcode-cli/packages/adapters/src/mcp/index.ts mcpRequestMeta 的注入形状）。
 * 模型调用与面板调用都会注入；缺失即事实不足 → fail-closed。
 */

const optionalFact = z.string().min(1).nullish();

export const toolCallMetaSchema = z.object({
  session_id: optionalFact,
  root_session_id: optionalFact,
  turn_id: optionalFact,
  workspace_path: optionalFact,
  workspace_identity: optionalFact,
  workspace_key: optionalFact,
  trace_id: optionalFact,
  runtime_scope: optionalFact,
});

export type ToolCallMeta = z.infer<typeof toolCallMetaSchema>;

/** 从 tools/call 请求 `_meta`（或 com.zcode/request-context 镜像）提取会话事实；缺失返回 null。 */
export function sessionFactsFromToolCallMeta(meta: unknown): ToolCallMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  const source = record["com.zcode/request-context"];
  const candidate =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : record;
  const parsed = toolCallMetaSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
