/**
 * 集成测试：真实 ZCode MCP 客户端栈 + 真实凭据存储 + 本地替身 stdio server。
 * 证明 ProviderPort 端口契约与真实底物兼容（结构化注入的接缝是真实可接的）。
 *
 * 运行前提（与 apps/zcode-cli 包自身的 vitest 套件同约定）：
 *   pnpm --filter @zcode/adapters... build   # 产出 dist 导出
 *   pnpm --filter @mos/adapters test
 * 本文件不进入 scripts/engineering-test-files.json（工程套件不依赖 CLI dist 构建）。
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  createMcpAdapter,
  createSharedZCodeCredentialStore,
} from "@zcode/adapters";
import type { McpPort } from "@zcode/contracts";
import {
  classifyProviderError,
  parseProviderToolName,
  providerErrorAction,
  toProviderToolName,
  type ProviderPort,
  type ProviderServerConfig,
  type ProviderServerState,
} from "../../src/index.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/standin-mcp-server.mjs", import.meta.url));

/**
 * 测试本地组合：把 ProviderPort 适配到真实 McpPort。
 * 生产组合根将来做的就是这一层适配（W1 的应用内接线 deferred，见 IMPLEMENTATION-STATE）。
 */
function providerPortOverMcp(mcp: McpPort): ProviderPort {
  const toConfig = (config: ProviderServerConfig) => {
    if (config.kind === "stdio") {
      return {
        type: "stdio" as const,
        command: config.command,
        ...(config.args ? { args: [...config.args] } : {}),
        ...(config.env ? { env: { ...config.env } } : {}),
      };
    }
    return {
      type: config.kind,
      url: config.url,
      ...(config.headers ? { headers: { ...config.headers } } : {}),
    };
  };
  return {
    async connectServer(name, config) {
      const status = await mcp.connectServer(name, toConfig(config), {});
      return {
        status: status.status,
        error: status.error ?? null,
        toolCount: status.toolCount ?? null,
      };
    },
    async listTools() {
      const tools = await mcp.listTools();
      return tools.map((tool) => ({
        serverName: tool.serverName,
        toolName: tool.toolName,
        canonicalName: tool.name ?? toProviderToolName(tool.serverName, tool.toolName),
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? null,
        annotations: tool.annotations
          ? {
              ...(tool.annotations.readOnlyHint !== undefined ? { readOnlyHint: tool.annotations.readOnlyHint } : {}),
              ...(tool.annotations.destructiveHint !== undefined ? { destructiveHint: tool.annotations.destructiveHint } : {}),
            }
          : null,
      }));
    },
    async callTool(request) {
      const result = await mcp.callTool({
        serverName: request.serverName,
        toolName: request.toolName,
        ...(request.arguments ? { arguments: request.arguments } : {}),
        ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      });
      return {
        content: [...(result.content ?? [])],
        isError: result.isError === true,
        structuredContent: result.structuredContent ?? null,
      };
    },
    async status(): Promise<Record<string, ProviderServerState>> {
      const statuses = await mcp.status();
      const mapped: Record<string, ProviderServerState> = {};
      for (const [name, state] of Object.entries(statuses)) {
        mapped[name] = {
          status: state.status,
          error: state.error ?? null,
          toolCount: state.toolCount ?? null,
        };
      }
      return mapped;
    },
    async close() {
      return mcp.close();
    },
  };
}

const ports: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const port of ports.splice(0)) await port.close().catch(() => {});
});

async function connectStandin(): Promise<ProviderPort> {
  const mcp: McpPort = createMcpAdapter({ clientName: "mos-integration", clientVersion: "0.1.0" });
  const provider = providerPortOverMcp(mcp);
  ports.push(provider);
  const state = await provider.connectServer("standin-hubspot", {
    kind: "stdio",
    command: process.execPath,
    args: [FIXTURE],
  });
  expect(state.status).toBe("connected");
  return provider;
}

describe("real ZCode MCP client stack over ProviderPort", () => {
  test("stdio stand-in server connects through the real client", async () => {
    const provider = await connectStandin();
    const status = await provider.status();
    expect(status["standin-hubspot"]?.status).toBe("connected");
  });

  test("listTools surfaces the read-only tool with annotations", async () => {
    const provider = await connectStandin();
    const tools = await provider.listTools();
    const tool = tools.find((candidate) => candidate.toolName === "hubspot_search_contacts");
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(parseProviderToolName(tool?.canonicalName ?? "")?.serverName).toBe("standin-hubspot");
  });

  test("read tool call succeeds end-to-end with structured content passthrough", async () => {
    const provider = await connectStandin();
    const result = await provider.callTool({
      serverName: "standin-hubspot",
      toolName: "hubspot_search_contacts",
      arguments: { query: "newsletter subscribers" },
    });
    expect(result.isError).toBe(false);
    const text = result.content.find((block) => typeof block.text === "string")?.text ?? "";
    expect(JSON.parse(text)).toEqual({ records: [], query: "newsletter subscribers" });
  });

  test("expired-token failure path classifies to unauthorized and invalidates the instance", async () => {
    const provider = await connectStandin();
    const result = await provider.callTool({
      serverName: "standin-hubspot",
      toolName: "hubspot_search_contacts",
      arguments: { query: "x", __simulate: "expired" },
    });
    expect(result.isError).toBe(true);
    const classified = classifyProviderError({
      content: result.content,
    });
    expect(classified.kind).toBe("unauthorized");
    expect(providerErrorAction(classified.kind)).toBe("invalidate_instance");
  });

  test("failing server startup surfaces as failed status (fail-closed)", async () => {
    const mcp: McpPort = createMcpAdapter({ clientName: "mos-integration", clientVersion: "0.1.0" });
    const provider = providerPortOverMcp(mcp);
    const state = await provider.connectServer("broken", {
      kind: "stdio",
      command: "/nonexistent/mos-integration-probe",
      args: [],
    });
    expect(state.status).toBe("failed");
    expect(state.error).not.toBeNull();
    const tools = await provider.listTools();
    expect(tools.length).toBe(0);
  });
});

describe("real shared credential store", () => {
  test("save/load round-trips through the real encrypted file store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mos-credentials-"));
    const store = createSharedZCodeCredentialStore({ filePath: join(dir, "credentials.json") });
    await store.save("mcp:oauth:test-prefix:tokens", "opaque-value-placeholder");
    expect(await store.load("mcp:oauth:test-prefix:tokens")).toBe("opaque-value-placeholder");
    await store.delete("mcp:oauth:test-prefix:tokens");
    expect(await store.load("mcp:oauth:test-prefix:tokens")).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("secret material is never stored in plaintext on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mos-credentials-"));
    const filePath = join(dir, "credentials.json");
    const store = createSharedZCodeCredentialStore({ filePath });
    await store.save("mcp:oauth:test-prefix:tokens", "plaintext-secret-that-must-not-leak");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("plaintext-secret-that-must-not-leak");
    await rm(dir, { recursive: true, force: true });
  });

  test("credential_ref semantics: opaque keys only, values retrievable by the owner port", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mos-credentials-"));
    const store = createSharedZCodeCredentialStore({ filePath: join(dir, "credentials.json") });
    const credentialRef = "mcp:oauth:0123456789abcdef01234567";
    await store.save(`${credentialRef}:tokens`, "opaque");
    // MOS 只保存 credential_ref 前缀本身；永不读取/记录存储的值。
    expect(await store.load(`${credentialRef}:tokens`)).toBe("opaque");
    await rm(dir, { recursive: true, force: true });
  });
});

/**
 * 本地替身 streamable HTTP MCP server（contract-only，同目录 fixtures/standin-http-mcp-server.mjs）：
 * 验证 ProviderPort http 配置的 headers 透传（W2：Composio session MCP 的授权形态）。
 * 与 stdio 替身同语义级别：真实 ZCode MCP 客户端栈 + 真实 http transport，
 * 不是任何真实 provider 端点的替代证据（live 证据见 composio-live-stack.test.ts）。
 */
describe("real ZCode MCP client stack over http transport with header auth", () => {
  const HTTP_FIXTURE = fileURLToPath(
    new URL("../fixtures/standin-http-mcp-server.mjs", import.meta.url),
  );

  async function startStandinHttp(): Promise<{ url: string; stop(): Promise<void> }> {
    const child = spawn(process.execPath, [HTTP_FIXTURE], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const port = await new Promise<number>((resolve, reject) => {
      const stdout = child.stdout;
      if (!stdout) {
        reject(new Error("standin http server has no stdout"));
        return;
      }
      const timer = setTimeout(
        () => reject(new Error("standin http server did not start")),
        10_000,
      );
      stdout.once("data", (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(Number(String(chunk).trim()));
      });
    });
    return {
      url: `http://127.0.0.1:${port}/`,
      stop: () =>
        new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.kill();
        }),
    };
  }

  test("http server connects with the injected x-api-key header and serves tools", async () => {
    const standin = await startStandinHttp();
    try {
      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.1.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      const state = await provider.connectServer("standin-http", {
        kind: "http",
        url: standin.url,
        headers: { "x-api-key": "standin-test-key" },
      });
      expect(state.status).toBe("connected");
      const tools = await provider.listTools();
      const tool = tools.find((candidate) => candidate.toolName === "http_echo_read");
      expect(tool).toBeDefined();
      expect(parseProviderToolName(tool?.canonicalName ?? "")?.serverName).toBe("standin-http");

      const result = await provider.callTool({
        serverName: "standin-http",
        toolName: "http_echo_read",
        arguments: { query: "http passthrough" },
      });
      expect(result.isError).toBe(false);
      const text = result.content.find((block) => typeof block.text === "string")?.text ?? "";
      expect(JSON.parse(text)).toEqual({ records: [], query: "http passthrough" });
    } finally {
      await standin.stop();
    }
  });

  test("wrong header value fails closed (401 → status=failed, no tools)", async () => {
    const standin = await startStandinHttp();
    try {
      const mcp: McpPort = createMcpAdapter({
        clientName: "mos-integration",
        clientVersion: "0.1.0",
      });
      const provider = providerPortOverMcp(mcp);
      ports.push(provider);
      const state = await provider.connectServer("standin-http-bad", {
        kind: "http",
        url: standin.url,
        headers: { "x-api-key": "wrong-key" },
      });
      expect(state.status).toBe("failed");
      expect(state.error).not.toBeNull();
      const tools = await provider.listTools();
      expect(tools.filter((tool) => tool.serverName === "standin-http-bad")).toEqual([]);
    } finally {
      await standin.stop();
    }
  });
});
