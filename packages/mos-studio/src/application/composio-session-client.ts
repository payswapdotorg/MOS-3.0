import {
  COMPOSIO_SESSION_FACTORY_URL,
  composioSessionRequestSchema,
  composioSessionResponseSchema,
} from "@mos/integrations";

/**
 * Composio hosted session 工厂客户端（REST；W2 live 已核实的唯一 I/O 形状）。
 * 生产组合根的职责之一：@mos/integrations 只交付 schema 与 URL 常量，I/O 归组合根。
 * 授权材料只经 x-api-key header 运行时注入；绝不进源码/日志/持久配置。
 */

export interface ComposioSessionClientDeps {
  /** session 工厂 URL（默认真实工厂；集成测试注入本地替身）。 */
  readonly factoryUrl?: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export interface ComposioSession {
  readonly sessionId: string;
  readonly mcpUrl: string;
}

/** no-auth toolkit 集合（真实外部数据读的最小面；W2 live 观测同款）。 */
export const COMPOSIO_SESSION_TOOLKITS = ["hackernews"] as const;

export async function createComposioSession(
  deps: ComposioSessionClientDeps,
  input: { apiKey: string; userId: string },
): Promise<ComposioSession> {
  const request = composioSessionRequestSchema.parse({
    user_id: input.userId,
    mcp: true,
    toolkits: { enable: [...COMPOSIO_SESSION_TOOLKITS] },
  });
  const response = await deps.fetch(deps.factoryUrl ?? COMPOSIO_SESSION_FACTORY_URL, {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
  });
  // POST create：201 Created 或 200（幂等复用）都算成功（与 W2 live 观测一致）。
  if (response.status !== 200 && response.status !== 201) {
    throw new ComposioSessionError(
      `composio session factory returned ${response.status}`,
      response.status,
    );
  }
  const parsed = composioSessionResponseSchema.parse(await response.json());
  return { sessionId: parsed.session_id, mcpUrl: parsed.mcp.url };
}

/** 类型化错误（httpStatus 保留给分类器；不内嵌响应体）。 */
export class ComposioSessionError extends Error {
  readonly httpStatus: number | null;
  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "ComposioSessionError";
    this.httpStatus = httpStatus;
  }
}
