/**
 * Provider 底物端口 —— MOS 与 provider I/O 之间的唯一接缝（结构化注入）。
 * 生产代码不 import 任何 ZCode 包；组合根（W1 后续接线）负责把该端口适配到
 * 真实 ZCode MCP 客户端栈。形状刻意贴近 McpPort 的最小子集，便于适配。
 */

export interface ProviderToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
}

export interface ProviderToolDescriptor {
  readonly serverName: string;
  readonly toolName: string;
  /** 规范名：mcp__<server>__<tool>，与 ZCode 工具名合成规则一致。 */
  readonly canonicalName: string;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown> | null;
  readonly annotations: ProviderToolAnnotations | null;
}

export interface ProviderCallToolRequest {
  readonly serverName: string;
  readonly toolName: string;
  readonly arguments?: Record<string, unknown>;
  readonly timeoutMs?: number;
}

export interface ProviderContentBlock {
  readonly type?: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface ProviderToolCallResult {
  readonly content: readonly ProviderContentBlock[];
  readonly isError: boolean;
  readonly structuredContent: unknown;
}

export type ProviderServerStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "disabled"
  | "untrusted";

export interface ProviderServerState {
  readonly status: ProviderServerStatus;
  readonly error: string | null;
  readonly toolCount: number | null;
}

/** MOS 中立的 server 配置；组合根负责映射到具体运行时配置。
 * http/sse 的 headers 只承载注入的授权材料（如 provider 文档化的 API-key header），
 * 值只允许来自凭据存储/环境（运行时注入），永不进入源码、日志或持久化配置。 */
export type ProviderServerConfig =
  | { readonly kind: "stdio"; readonly command: string; readonly args?: readonly string[]; readonly env?: Record<string, string> }
  | { readonly kind: "http"; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: "sse"; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

export interface ProviderPort {
  connectServer(name: string, config: ProviderServerConfig): Promise<ProviderServerState>;
  disconnectServer?(name: string): Promise<ProviderServerState | undefined>;
  listTools(): Promise<readonly ProviderToolDescriptor[]>;
  callTool(request: ProviderCallToolRequest): Promise<ProviderToolCallResult>;
  status(): Promise<Readonly<Record<string, ProviderServerState>>>;
  close(): Promise<void>;
}
