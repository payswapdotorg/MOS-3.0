import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { InMemoryProviderPort } from "@mos/adapters";
import type { TimePort } from "@mos/adapters";
import {
  StudioConnectionNotFoundError,
  StudioDataDirUnavailableError,
  StudioInvalidInputError,
  StudioService,
  type CredentialStorePort,
  type StudioPorts,
  type StudioSessionContext,
} from "../src/application/studio-service.js";
import { COMPOSIO_CREDENTIAL_REF } from "../src/contract/studio-vocabulary.js";
import { runSessionStartHook } from "../src/hook/main.js";

/**
 * 完整旅程（工程层，结构性端口替身；真实栈证据在 test/integration）：
 * New Task（SessionStart startup payload）→ Mission sidecar（graceful failure）→
 * 操作者声明 → 逐字 intake → 连接 Composio（key 只进凭据端口）→ 能力解析 available →
 * 路由评估 existing → 一次授权读（counts/shapes 证据；绝不复制记录值）。
 * 负向矩阵：未声明操作者、无连接、错误 key、跨 tenant、无数据目录 —— 全部 fail-closed 类型化。
 */

class FixedTimePort implements TimePort {
  now(): string {
    return "2026-11-13T12:00:00.000Z";
  }
}

function memoryCredentialStore(initial: Record<string, string> = {}): CredentialStorePort & {
  snapshot(): ReadonlyMap<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    async save(key, value) {
      values.set(key, value);
    },
    async load(key) {
      return values.get(key) ?? null;
    },
    snapshot() {
      return new Map(values);
    },
  };
}

function standInSessionFactoryFetch(): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ session_id: "standin-session-1", mcp: { type: "http", url: "http://127.0.0.1:9/mcp" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const CONTEXT: StudioSessionContext = {
  sessionId: "sess_journey_1",
  workspacePath: "/home/z/project",
  workspaceIdentity: null,
  workspaceKey: "/home/z/project",
};

const STARTUP_PAYLOAD = JSON.stringify({
  hookEventName: "SessionStart",
  sessionId: CONTEXT.sessionId,
  cwd: CONTEXT.workspacePath,
  timestamp: "2026-11-13T12:00:01.000Z",
  source: "startup",
  session_id: CONTEXT.sessionId,
  hook_event_name: "SessionStart",
});

async function newJourney() {
  const directory = await mkdtemp(join(tmpdir(), "mos-studio-journey-"));
  directories.push(directory);
  const provider = new InMemoryProviderPort();
  const credentialStore = memoryCredentialStore();
  const ports: StudioPorts = {
    createProviderPort: () => provider,
    credentialStore,
    time: new FixedTimePort(),
    fetch: standInSessionFactoryFetch(),
  };
  const service = new StudioService({ dataDir: directory, ports });
  return { directory, provider, credentialStore, service };
}

describe("New Task -> Mission journey (sidecar, graceful failure)", () => {
  test("hook without operator declaration settles as sidecar_error, never throws", async () => {
    const { directory } = await newJourney();
    const outcome = await runSessionStartHook(STARTUP_PAYLOAD, { dataDir: directory });
    expect(outcome.outcome).toBe("sidecar_error");
    expect(outcome.sessionId).toBe(CONTEXT.sessionId);
  });

  test("hook after operator declaration creates + links the mission (idempotent)", async () => {
    const { directory, service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });

    const first = await runSessionStartHook(STARTUP_PAYLOAD, { dataDir: directory });
    expect(first.outcome).toBe("mission_created");

    // 幂等：同 session 再触发不重复
    const second = await runSessionStartHook(STARTUP_PAYLOAD, { dataDir: directory });
    expect(second.outcome).toBe("mission_created");
    const missions = await service.listMissions(CONTEXT);
    expect(missions).toHaveLength(1);
    expect(missions[0]?.source_zcode_session_id).toBe(CONTEXT.sessionId);
    expect(missions[0]?.objective).toContain("Mission sidecar for task");
  });

  test("status links the mission and flips availability to available", async () => {
    const { directory, service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    const before = await service.status(CONTEXT);
    expect(before.mission).toBeNull();
    expect(before.availability).toEqual({ available: false, reason: "no_mission" });
    expect(before.tenant).toBe("/home/z/project");

    await runSessionStartHook(STARTUP_PAYLOAD, { dataDir: directory });
    const after = await service.status(CONTEXT);
    expect(after.mission).not.toBeNull();
    expect(after.availability).toEqual({ available: true, reason: null });
  });

  test("recordMissionIntake stores the objective verbatim with the session reference", async () => {
    const { service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    const mission = await service.recordMissionIntake(CONTEXT, {
      objective_verbatim: "Grow the PaySwap newsletter 20% in Q1 2027",
    });
    expect(mission.objective).toBe("Grow the PaySwap newsletter 20% in Q1 2027");
    expect(mission.source_zcode_session_id).toBe(CONTEXT.sessionId);
  });
});

describe("capabilities and routes (fail-closed)", () => {
  test("no connection yet: capabilities empty and routes evaluate unknown (no instances)", async () => {
    const { service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });

    expect(await service.capabilities(CONTEXT)).toEqual([]);
    const routes = await service.routes(CONTEXT);
    expect(routes.summary.unknown).toBe(1);
    expect(routes.routes[0]?.unknowns).toContain("no_capability_instances_resolved");
  });

  test("connect stores the key only in the credential port; capabilities resolve available; routes existing", async () => {
    const { service, credentialStore } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await expect(
      service.connectComposio(CONTEXT, { apiKey: "   " }),
    ).rejects.toThrow(StudioInvalidInputError);

    const connection = await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });
    expect(connection.provider_id).toBe("composio");
    expect(connection.status).toBe("connected");
    expect(connection.credential_ref).toBe(COMPOSIO_CREDENTIAL_REF);
    // key 只进凭据端口；连接记录/投影只有不透明引用
    expect(JSON.stringify(connection)).not.toContain("standin-key-material");
    expect(credentialStore.snapshot().get(COMPOSIO_CREDENTIAL_REF)).toBe("standin-key-material");

    const capabilities = await service.capabilities(CONTEXT);
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]?.status).toBe("available");
    expect(capabilities[0]?.tool_mapping_verified).toBe(true);

    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    const routes = await service.routes(CONTEXT);
    expect(routes.summary.existing).toBe(1);
  });

  test("routes for the intake mission evaluate existing after connect", async () => {
    const { service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    const mission = await service.recordMissionIntake(CONTEXT, {
      objective_verbatim: "objective for routes",
    });
    await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });
    const routes = await service.routes(CONTEXT, mission.id);
    expect(routes.summary.existing).toBe(1);
    expect(routes.routes[0]?.route_class).toBe("existing");
  });
});

describe("one authorized read (structural stand-in; counts/shapes only)", () => {
  test("succeeded: evidence carries counts/shapes, never record values", async () => {
    const { service, provider } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });
    provider.registerTool({
      serverName: "composio-session",
      toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
      respond: () => ({
        content: [{ type: "text", text: "ok" }],
        isError: false,
        structuredContent: {
          successful: true,
          hits: [
            { id: "hit-1", SECRET_RECORD_VALUE: "RECORD_VALUE_MARKER_1" },
            { id: "hit-2", SECRET_RECORD_VALUE: "RECORD_VALUE_MARKER_2" },
            { id: "hit-3", SECRET_RECORD_VALUE: "RECORD_VALUE_MARKER_3" },
          ],
        },
      }),
    });

    const outcome = await service.executeAuthorizedRead(CONTEXT, {
      query: "marketing automation",
    });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.evidence.observed_via).toBe("composio-session-mcp");
    expect(outcome.evidence.tool).toBe("COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(outcome.evidence.connection_id).toBe("conn:composio");
    expect(outcome.evidence.observed_at).toBe("2026-11-13T12:00:00.000Z");
    expect(outcome.evidence.facts.recordCount).toBe(3);
    expect(outcome.evidence.facts.recordCountBasis).toBe("structured_content");
    // 记录值绝不进入返回（counts/shapes only）
    expect(JSON.stringify(outcome)).not.toContain("RECORD_VALUE_MARKER");
  });

  test("provider 401 → classified unauthorized with invalidate action (no retry)", async () => {
    const { service, provider } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });
    provider.failNextToolCall(
      "COMPOSIO_MULTI_EXECUTE_TOOL",
      "HTTP 401: token expired or revoked; re-auth required",
    );
    const outcome = await service.executeAuthorizedRead(CONTEXT, { query: "x" });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.classified).toBe("unauthorized");
    expect(outcome.action).toBe("invalidate_instance");
    expect(provider.recordedCalls()).toHaveLength(1);
  });

  test("no connection → typed ConnectionNotFoundError (no provider call)", async () => {
    const { service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await expect(
      service.executeAuthorizedRead(CONTEXT, { query: "x" }),
    ).rejects.toThrow(StudioConnectionNotFoundError);
  });

  test("missing credential → blocked credential_missing", async () => {
    const { directory, service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });

    // 凭据被外部清除的真实场景：同 dataDir 新 service 实例 + 空凭据端口 →
    // 连接存在但凭据缺失 → blocked（fail-closed，不做 provider 调用）
    const provider2 = new InMemoryProviderPort();
    const service2 = new StudioService({
      dataDir: directory,
      ports: {
        createProviderPort: () => provider2,
        credentialStore: memoryCredentialStore(),
        time: new FixedTimePort(),
        fetch: standInSessionFactoryFetch(),
      },
    });
    const outcome = await service2.executeAuthorizedRead(CONTEXT, { query: "x" });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toBe("credential_missing");
    expect(provider2.recordedCalls()).toHaveLength(0);
  });
});

describe("tenant boundaries (fail-closed)", () => {
  test("no operator declaration → typed tenant error on reads", async () => {
    const { service } = await newJourney();
    await expect(service.listMissions(CONTEXT)).rejects.toThrow(/tenant unavailable/);
  });

  test("another workspace is another tenant: no cross-tenant mission/connection visibility", async () => {
    const { directory, service } = await newJourney();
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    await runSessionStartHook(STARTUP_PAYLOAD, { dataDir: directory });
    await service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });

    const otherContext: StudioSessionContext = {
      sessionId: "sess_other",
      workspacePath: "/home/z/other",
      workspaceIdentity: null,
      workspaceKey: "/home/z/other",
    };
    const missions = await service.listMissions(otherContext);
    expect(missions).toHaveLength(0);
    await expect(
      service.executeAuthorizedRead(otherContext, { query: "x" }),
    ).rejects.toThrow(StudioConnectionNotFoundError);
  });

  test("null data dir → typed StudioDataDirUnavailableError", async () => {
    const provider = new InMemoryProviderPort();
    const service = new StudioService({
      dataDir: null,
      ports: {
        createProviderPort: () => provider,
        credentialStore: memoryCredentialStore(),
        time: new FixedTimePort(),
        fetch: standInSessionFactoryFetch(),
      },
    });
    await expect(service.listMissions(CONTEXT)).rejects.toThrow(StudioDataDirUnavailableError);
  });
});
