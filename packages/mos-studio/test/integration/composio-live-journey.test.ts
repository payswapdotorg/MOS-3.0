import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { createMcpAdapter, createSharedZCodeCredentialStore } from "@zcode/adapters";
import type { McpPort, McpToolCallResult } from "@zcode/contracts";
import type { SessionId, TraceId, TurnId } from "@zcode/contracts";

/**
 * 真实 provider 读的 live 旅程（env COMPOSIO_API_KEY 存在才运行；否则整段 skip）：
 * 真实 Composio REST session 工厂 → 真实 hosted session MCP →
 * COMPOSIO_MULTI_EXECUTE_TOOL → HACKERNEWS_SEARCH_POSTS 一次真实外部数据读。
 * 与 W2 的 composio-live-stack.test.ts 同一 provider/凭据纪律：key 只在 env 与
 * 真实加密凭据存储中流转，绝不进源码/日志/断言文本。
 *
 * 运行前提：
 *   pnpm --filter @zcode/adapters... build
 *   pnpm --filter @mos/studio build
 *   COMPOSIO_API_KEY=... pnpm --filter @mos/studio test
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const serverBundle = join(packageRoot, "dist", "server.mjs");
const hookBundle = join(packageRoot, "dist", "hook.mjs");

const apiKey = process.env.COMPOSIO_API_KEY ?? "";
const liveSuite = apiKey.length > 0 ? describe : describe.skip;

const SESSION_ID = "sess_live_journey_1";
const WORKSPACE = "/home/z/project";

const ports: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const port of ports.splice(0)) await port.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function requireBundles(): void {
  for (const bundle of [serverBundle, hookBundle]) {
    if (!existsSync(bundle)) {
      throw new Error(
        `missing ${bundle}; run \`pnpm --filter @zcode/adapters... build\` then \`pnpm --filter @mos/studio build\``,
      );
    }
  }
}

async function newTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

liveSuite("live composio journey through the built plugin", () => {
  test("New Task -> Mission -> capabilities -> routes -> real authorized read (Hacker News)", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-live-data-");
    const credentialBaseDir = await newTempDir("mos-live-cred-");

    const mcp: McpPort = createMcpAdapter({ clientName: "mos-live-journey", clientVersion: "0.1.0" });
    ports.push(mcp);
    const state = await mcp.connectServer(
      "mos-studio",
      {
        type: "stdio",
        command: process.execPath,
        args: [serverBundle],
        env: {
          ZCODE_PLUGIN_DATA: dataDir,
          ZCODE_DATA_BASE_DIR: credentialBaseDir,
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
        trace: {
          traceId: "trace-live-1" as TraceId,
          sessionId: SESSION_ID as SessionId,
          turnId: "turn-1" as TurnId,
        },
        workspacePath: WORKSPACE,
        workspaceKey: WORKSPACE,
      });
    const parse = (result: McpToolCallResult) =>
      (result.structuredContent ?? {}) as Record<string, unknown>;

    // 操作者声明（tenant 解析前置）+ 真实 hook 产物 → mission
    await call("mos_set_operator", { user_id: "operator@example.test" });
    const hookExit = await new Promise<number>((resolve, reject) => {
      const payload = JSON.stringify({
        hookEventName: "SessionStart",
        sessionId: SESSION_ID,
        cwd: WORKSPACE,
        timestamp: new Date().toISOString(),
        source: "startup",
        session_id: SESSION_ID,
        hook_event_name: "SessionStart",
      });
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
    const missions = parse(await call("mos_list_missions"));
    expect(((missions.items ?? []) as unknown[])).toHaveLength(1);

    // 面板同款连接流：mos_connect_composio（key 只经本地工具参数流动 → 真实加密凭据存储；
    // 连接记录只存不透明引用；返回绝不回显 key —— 由下方断言机器保证）
    const connection = parse(await call("mos_connect_composio", { api_key: apiKey }));
    expect(connection.credential_ref).toBe("mcp:apikey:composio-studio:header");
    expect(JSON.stringify(connection)).not.toContain(apiKey);

    // 连接已成立（面板同款）→ 能力解析 available（真实 toolMappingVerified + 实现证据）
    const capabilities = parse(await call("mos_capabilities"));
    const capabilityItems = (capabilities.items ?? []) as Array<Record<string, unknown>>;
    expect(capabilityItems).toHaveLength(1);
    expect(capabilityItems[0]?.status).toBe("available");

    // 路由评估 existing
    const routes = parse(await call("mos_routes"));
    expect((routes.summary as Record<string, unknown>).existing).toBe(1);

    // 一次真实授权读：HACKERNEWS_SEARCH_POSTS（真实外部数据）
    const read = parse(
      await call("mos_execute_authorized_read", { query: "marketing automation", limit: 3 }),
    );
    expect(read.status).toBe("succeeded");
    const evidence = (read.evidence ?? {}) as Record<string, unknown>;
    expect(evidence.observed_via).toBe("composio-session-mcp");
    expect(evidence.tool).toBe("COMPOSIO_MULTI_EXECUTE_TOOL");
    const facts = (evidence.facts ?? {}) as Record<string, unknown>;
    // Composio 文档化形状的计数投影（只计数；通用 recordCount 对该形状如实为 null=unknown）
    const composio = (facts.composio ?? {}) as Record<string, unknown>;
    expect(composio.results_count).toBeGreaterThanOrEqual(1);
    expect(composio.total_count).toBeGreaterThanOrEqual(1);
    // 绝不把 key 带进任何返回或断言文本（只在 env/凭据库中存在）
    expect(JSON.stringify(read)).not.toContain(apiKey);
  }, 180_000);

  test("wrong api key fails closed (401 → unauthorized classification)", async () => {
    requireBundles();
    const dataDir = await newTempDir("mos-live-401-");
    const credentialBaseDir = await newTempDir("mos-live-cred401-");
    const credentialStore = createSharedZCodeCredentialStore({
      filePath: join(credentialBaseDir, "v2", "credentials.json"),
    });
    await credentialStore.save("mcp:apikey:composio-studio:header", "composio-invalid-key-for-401-test");

    const mcp: McpPort = createMcpAdapter({ clientName: "mos-live-401", clientVersion: "0.1.0" });
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
    const call = (tool: string, args: Record<string, unknown> = {}) =>
      mcp.callTool({
        serverName: "mos-studio",
        toolName: tool,
        arguments: args,
        trace: {
          traceId: "trace-401" as TraceId,
          sessionId: "sess_live_401" as SessionId,
          turnId: "turn-1" as TurnId,
        },
        workspacePath: WORKSPACE,
        workspaceKey: WORKSPACE,
      });
    const parse = (result: McpToolCallResult) =>
      (result.structuredContent ?? {}) as Record<string, unknown>;
    await call("mos_set_operator", { user_id: "operator@example.test" });
    await call("mos_connect_composio", { api_key: "composio-invalid-key-for-401-test" });

    const read = parse(await call("mos_execute_authorized_read", { query: "x" }));
    // session 工厂 401 → failed（unauthorized 分类；具体分类词不断言死，401 必不入 succeeded）
    expect(read.status).not.toBe("succeeded");
    expect(JSON.stringify(read)).not.toContain("composio-invalid-key-for-401-test");
  }, 120_000);

  test("credential store round-trip is encrypted at rest (same store as the plugin)", async () => {
    const credentialBaseDir = await newTempDir("mos-live-atrest-");
    const filePath = join(credentialBaseDir, "v2", "credentials.json");
    const credentialStore = createSharedZCodeCredentialStore({ filePath });
    await credentialStore.save("mcp:apikey:composio-studio:header", "plaintext-must-not-appear");
    const raw = await readFile(filePath, "utf8");
    expect(raw.includes("plaintext-must-not-appear")).toBe(false);
  });
});
