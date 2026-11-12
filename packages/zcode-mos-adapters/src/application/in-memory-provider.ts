import type {
  ProviderCallToolRequest,
  ProviderPort,
  ProviderServerConfig,
  ProviderServerState,
  ProviderToolCallResult,
  ProviderToolDescriptor,
} from "../contract/provider-port.js";

/**
 * 测试用 InMemoryProviderPort：契约测试的脚本化替身（明确标注 contract-only，
 * 不得作为生产连通性证据——AGENTS.md §4）。
 */

export interface InMemoryProviderTool {
  readonly serverName: string;
  readonly toolName: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  /** 固定应答；未设置时返回错误结果。 */
  readonly respond?: (request: ProviderCallToolRequest) => ProviderToolCallResult;
}

export interface InMemoryCallRecord {
  readonly request: ProviderCallToolRequest;
  readonly result: ProviderToolCallResult | null;
  readonly failure: string | null;
}

export class InMemoryProviderPort implements ProviderPort {
  private readonly servers = new Map<string, { config: ProviderServerConfig; state: ProviderServerState }>();
  private readonly tools: InMemoryProviderTool[] = [];
  private readonly calls: InMemoryCallRecord[] = [];
  private readonly failures = new Map<string, string>();

  registerTool(tool: InMemoryProviderTool): void {
    this.tools.push(tool);
  }

  failNextToolCall(toolName: string, message: string): void {
    this.failures.set(toolName, message);
  }

  connectServer(name: string, config: ProviderServerConfig): Promise<ProviderServerState> {
    const state: ProviderServerState = { status: "connected", error: null, toolCount: this.tools.filter((t) => t.serverName === name).length };
    this.servers.set(name, { config, state });
    return Promise.resolve(state);
  }

  disconnectServer(name: string): Promise<ProviderServerState | undefined> {
    const entry = this.servers.get(name);
    if (!entry) return Promise.resolve(undefined);
    const state: ProviderServerState = { status: "disconnected", error: null, toolCount: null };
    this.servers.set(name, { config: entry.config, state });
    return Promise.resolve(state);
  }

  listTools(): Promise<readonly ProviderToolDescriptor[]> {
    return Promise.resolve(
      this.tools
        .filter((tool) => this.servers.has(tool.serverName))
        .map((tool) => ({
          serverName: tool.serverName,
          toolName: tool.toolName,
          canonicalName: `mcp__${tool.serverName}__${tool.toolName}`,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
          annotations: tool.annotations ?? null,
        })),
    );
  }

  async callTool(request: ProviderCallToolRequest): Promise<ProviderToolCallResult> {
    const tool = this.tools.find(
      (candidate) => candidate.serverName === request.serverName && candidate.toolName === request.toolName,
    );
    const failure = this.failures.get(request.toolName);
    if (failure) {
      this.failures.delete(request.toolName);
      this.calls.push({ request, result: null, failure });
      return { content: [{ type: "text", text: failure }], isError: true, structuredContent: null };
    }
    const result: ProviderToolCallResult = tool?.respond
      ? tool.respond(request)
      : { content: [{ type: "text", text: "tool not configured" }], isError: true, structuredContent: null };
    this.calls.push({ request, result, failure: null });
    return result;
  }

  status(): Promise<Readonly<Record<string, ProviderServerState>>> {
    const entries: Array<[string, ProviderServerState]> = [...this.servers.entries()].map(
      ([name, entry]) => [name, entry.state],
    );
    return Promise.resolve(Object.fromEntries(entries));
  }

  close(): Promise<void> {
    this.servers.clear();
    return Promise.resolve();
  }

  recordedCalls(): readonly InMemoryCallRecord[] {
    return this.calls;
  }
}
