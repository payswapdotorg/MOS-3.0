import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { createMcpAdapter, discoverNodePlugins } from "@zcode/adapters";
import type { McpPort, McpToolCallResult, SessionId, TraceId, TurnId } from "@zcode/contracts";

/**
 * 真实栈集成测试：构建产物 + 真实 ZCode 插件发现/装载 + 真实 MCP 客户端（stdio）+
 * 真实共享加密凭据存储（ZCODE_DATA_BASE_DIR 隔离）。
 *
 * 运行前提（与 @mos/adapters test/integration 同约定）：
 *   pnpm --filter @zcode/adapters... build
 *   pnpm --filter @mos/studio build
 *   pnpm --filter @mos/studio test
 * 本文件不进入 scripts/engineering-test-files.json（工程套件不依赖 CLI dist 构建）。
 * 本地替身（standin session factory/MCP）只验证接缝与传输，绝不作为真实 provider 证据；
 * 真实 provider 读的证据在 composio-live-journey.test.ts（env COMPOSIO_API_KEY）。
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverBundle = join(packageRoot, "dist", "server.mjs");
const hookBundle = join(packageRoot, "dist", "hook.mjs");
const panelBundle = join(packageRoot, "dist", "ui", "panel.html");
const standinFixture = fileURLToPath(new URL("../fixtures/standin-composio-session.mjs", import.meta.url));

const SESSION_ID = "sess_realstack_1";
const WORKSPACE = "/home/z/project";

const ports: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];
const standins: Array<{ kill(): void }> = [];

afterEach(async () => {
  for (const port of ports.splice(0)) await port.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  for (const standin of standins.splice(0)) standin.kill();
});

function requireBundles(): void {
  for (const bundle of [serverBundle, hookBundle, panelBundle]) {
    if (!existsSync(bundle)) {
      throw new Error(
        `missing ${bundle}; run \`pnpm --filter @mos/studio build\` (and \`pnpm --filter @zcode/adapters... build\` first)`,
      );
    }
  }
}

async function newTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** 启动本地替身 session 工厂 + session MCP（standin-composio-session.mjs）。 */
async function startStandinComposio(): Promise<{ url: string }> {
  const child = spawn(process.execPath, [standinFixture], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  standins.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("standin composio did not start")), 10_000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(Number(String(chunk).trim()));
    });
    child.once("exit", (code) => reject(new Error(`standin composio exited ${code}`)));
  });
  return { url: `http://127.0.0.1:${port}/session` };
}

/** 用真实 createMcpAdapter stdio 连接构建产物 server.mjs（真实客户端 → 真实插件 server）。 */
async function connectPluginServer(options: {
  dataDir: string;
  credentialBaseDir: string;
  factoryUrl?: string;
}): Promise<{ mcp: McpPort; call: (tool: string, args?: Record<string, unknown>) => Promise<McpToolCallResult> }> {
  const mcp = createMcpAdapter({ clientName: "mos-studio-realstack", clientVersion: "0.1.0" });
  ports.push(mcp);
  const state = await mcp.connectServer(
    "mos-studio",
    {
      type: "stdio",
      command: process.execPath,
      args: [serverBundle],
      env: {
        ZCODE_PLUGIN_DATA: options.dataDir,
        ZCODE_DATA_BASE_DIR: options.credentialBaseDir,
        ...(options.factoryUrl
          ? { ZCODE_MOS_COMPOSIO_SESSION_FACTORY_URL: options.factoryUrl }
          : {}),
      },
    },
    {},
  );
  expect(state.status).toBe("connected");
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    mcp.callTool({
      serverName: "mos-studio",
      toolName: tool,
      arguments: args,
      // 真实注入机制：trace + workspace 字段 → tools/call _meta（模型与面板调用同款）。
      trace: {
        traceId: "trace-realstack-1" as TraceId,
        sessionId: SESSION_ID as SessionId,
        turnId: "turn-1" as TurnId,
      },
      workspacePath: WORKSPACE,
      workspaceKey: WORKSPACE,
    });
  return { mcp, call };
}

/** 运行构建产物 hook.mjs（真实 SessionStart 投递形态：stdin JSON + env）。 */
async function runHookBundle(dataDir: string, sessionId: string): Promise<number> {
  const payload = JSON.stringify({
    hookEventName: "SessionStart",
    sessionId,
    cwd: WORKSPACE,
    timestamp: new Date().toISOString(),
    source: "startup",
    session_id: sessionId,
    hook_event_name: "SessionStart",
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookBundle], {
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, ZCODE_PLUGIN_DATA: dataDir },
    });
    child.stdin.write(`${payload}\n`);
    child.stdin.end();
    child.once("exit", (code) => resolve(code ?? -1));
    child.once("error", reject);
  });
}

function parseStructured(result: McpToolCallResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

describe("real ZCode plugin discovery validates the mos-studio manifest", () => {
  test("inline plugin via plugins.dirs: manifest + ui surface + hooks parse with zero diagnostics", async () => {
    const storageRoot = await newTempDir("mos-realstack-storage-");
    const outcome = await discoverNodePlugins({
      config: {
        dirs: [packageRoot],
        enabled: true,
        enabledPlugins: {},
        extraKnownMarketplaces: {},
        options: {},
        suppressedBuiltins: [],
      },
      storageRoot,
      workingDirectory: await newTempDir("mos-realstack-wd-"),
      env: {},
    });
    const plugin = outcome.plugins.find((candidate) => candidate.name === "mos-studio");
    expect(plugin).toBeDefined();
    expect(plugin?.enabled).toBe(true);
    expect(plugin?.uiSurfaces ?? []).toHaveLength(1);
    expect(plugin?.uiSurfaces?.[0]?.resourceUri).toBe("ui://mos-studio/panel.html");
    // 真实 loader 给 surface.server 换上运行时命名空间（plugin:<manifest>:<serverKey>）
    expect(plugin?.uiSurfaces?.[0]?.server).toBe("plugin:mos-studio:studio");
    expect(outcome.hooks.SessionStart).toBeDefined();
    expect(outcome.mcpServers["plugin:mos-studio:studio"]).toBeDefined();
    // 本插件的清单不得产生任何诊断（未知字段/非法 surface 等都会留痕）。
    const pluginDiagnostics = outcome.diagnostics.filter((diagnostic) =>
      String(diagnostic.pluginId ?? "").includes("mos-studio") ||
      String(diagnostic.message ?? "").includes("mos-studio"),
    );
    expect(pluginDiagnostics).toEqual([]);
  });
});

describe("real ZCode MCP client (stdio) drives the built plugin server", () => {
  test("full New Task -> Mission journey over the real stack (standin composio)", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-realstack-data-");
    const credentialBaseDir = await newTempDir("mos-realstack-cred-");
    const standin = await startStandinComposio();
    const { call } = await connectPluginServer({
      dataDir,
      credentialBaseDir,
      factoryUrl: standin.url,
    });

    // 1) 未声明操作者：状态可见，tenant fail-closed
    const initial = parseStructured(await call("mos_studio_status"));
    expect(initial.operator_configured).toBe(false);
    expect(initial.tenant).toBeNull();
    expect(initial.session).toBe(SESSION_ID);
    expect((initial.availability as Record<string, unknown>).available).toBe(false);

    // 2) 声明操作者（真实凭据库内尚无任何密钥；面板形态的 app-only 工具）
    const declared = parseStructured(await call("mos_set_operator", { user_id: "operator@example.test" }));
    expect(declared.userId).toBe("operator@example.test");

    // 3) 真实 hook 产物进程：SessionStart(startup) → mission sidecar（graceful failure）
    const hookExit = await runHookBundle(dataDir, SESSION_ID);
    expect(hookExit).toBe(0);

    // 4) mission 已创建并关联本会话（_meta 会话事实经真实客户端注入）
    const missions = parseStructured(await call("mos_list_missions"));
    const missionItems = (missions.items ?? []) as Array<Record<string, unknown>>;
    expect(missionItems).toHaveLength(1);
    expect(missionItems[0]?.source_zcode_session_id).toBe(SESSION_ID);

    const status = parseStructured(await call("mos_studio_status"));
    expect((status.availability as Record<string, unknown>).available).toBe(true);
    expect((status.mission as Record<string, unknown> | null)?.source_zcode_session_id).toBe(SESSION_ID);

    // 5) 连接 Composio（key 只进真实加密凭据存储；standin key）
    const connection = parseStructured(
      await call("mos_connect_composio", { api_key: "standin-composio-key" }),
    );
    expect(connection.credential_ref).toBe("mcp:apikey:composio-studio:header");
    expect(JSON.stringify(connection)).not.toContain("standin-composio-key");

    // 6) 能力解析 available（toolMappingVerified=true + 连接 + 实现证据）
    const capabilities = parseStructured(await call("mos_capabilities"));
    const capabilityItems = (capabilities.items ?? []) as Array<Record<string, unknown>>;
    expect(capabilityItems).toHaveLength(1);
    expect(capabilityItems[0]?.status).toBe("available");
    expect(capabilityItems[0]?.tool_mapping_verified).toBe(true);

    // 7) 路由评估 existing
    const routes = parseStructured(await call("mos_routes"));
    expect((routes.summary as Record<string, unknown>).existing).toBe(1);

    // 8) 一次授权读（真实 MCP 客户端 http transport + x-api-key 注入 → standin session MCP）
    const read = parseStructured(
      await call("mos_execute_authorized_read", { query: "marketing automation", limit: 3 }),
    );
    expect(read.status).toBe("succeeded");
    const evidence = (read.evidence ?? {}) as Record<string, unknown>;
    expect(evidence.observed_via).toBe("composio-session-mcp");
    const facts = (evidence.facts ?? {}) as Record<string, unknown>;
    // Composio 文档化形状的计数投影（替身与真实同款文本形状：data.results 计数）
    const composio = (facts.composio ?? {}) as Record<string, unknown>;
    expect(composio.results_count).toBe(2);
    expect(composio.total_count).toBe(2);
    // counts only：替身记录值绝不进入返回
    expect(JSON.stringify(read)).not.toContain("STANDIN_RECORD_MARKER");
  });

  test("hook resume (source != startup) never creates a mission", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-realstack-resume-");
    const credentialBaseDir = await newTempDir("mos-realstack-cred2-");
    const { call } = await connectPluginServer({ dataDir, credentialBaseDir });
    await call("mos_set_operator", { user_id: "operator@example.test" });

    const payload = JSON.stringify({
      hookEventName: "SessionStart",
      sessionId: "sess_resume_1",
      cwd: WORKSPACE,
      timestamp: new Date().toISOString(),
      source: "resume",
    });
    const hookExit = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [hookBundle], {
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, ZCODE_PLUGIN_DATA: dataDir },
      });
      child.stdin.write(`${payload}\n`);
      child.stdin.end();
      child.once("exit", (code) => resolve(code ?? -1));
      child.once("error", reject);
    });
    expect(hookExit).toBe(0);
    const missions = parseStructured(await call("mos_list_missions"));
    expect((missions.items ?? [])).toEqual([]);
  });

  test("read without a connection fails closed with a typed error", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-realstack-noconn-");
    const credentialBaseDir = await newTempDir("mos-realstack-cred3-");
    const { call } = await connectPluginServer({ dataDir, credentialBaseDir });
    await call("mos_set_operator", { user_id: "operator@example.test" });
    const read = await call("mos_execute_authorized_read", { query: "x" });
    expect(read.isError).toBe(true);
    expect(String(read.content[0]?.text)).toContain("StudioConnectionNotFoundError");
  });

  test("without session context the tools degrade honestly (no invented facts)", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-realstack-nometa-");
    const credentialBaseDir = await newTempDir("mos-realstack-cred4-");
    const mcp = createMcpAdapter({ clientName: "mos-studio-realstack", clientVersion: "0.1.0" });
    ports.push(mcp);
    await mcp.connectServer(
      "mos-studio",
      {
        type: "stdio",
        command: process.execPath,
        args: [serverBundle],
        env: { ZCODE_PLUGIN_DATA: dataDir, ZCODE_DATA_BASE_DIR: credentialBaseDir },
      },
      {},
    );
    // 不带 trace/workspace 字段 → 客户端不注入 _meta → 服务端如实降级
    const result = await mcp.callTool({
      serverName: "mos-studio",
      toolName: "mos_studio_status",
      arguments: {},
    });
    const status = parseStructured(result);
    expect(status.session).toBeNull();
    expect((status.availability as Record<string, unknown>).reason).toBe(
      "session_context_unavailable",
    );
  });
});
