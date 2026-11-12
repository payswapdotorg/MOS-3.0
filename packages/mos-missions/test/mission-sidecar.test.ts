import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemorySessionFactsPort,
  type SessionFactsPort,
  type TaskCreatedEvent,
  type TimePort,
  type ZCodeSessionFacts,
  type ZCodeUserIdentity,
  type ZCodeWorkspaceFacts,
} from "@mos/adapters";
import { IdentityBridgeService } from "@mos/identity-bridge";
import type { Mission } from "@mos/contracts";
import { MissionSidecarService, MissionStore } from "../src/index.js";

/**
 * Mission sidecar 矩阵（graceful failure）：
 * 任务创建事实 → tenant 可解析则创建带引用的 mission sidecar；
 * 不可解析/存储失败/端口缺能力 → 静默缺席 + lastErrors 记录，绝不抛入任务路径。
 */

const NOW = "2026-11-12T00:00:00Z";
const TENANT = "/work/acme";

const WORKSPACE: ZCodeWorkspaceFacts = {
  workspacePath: "/work/acme",
  workspaceIdentity: null,
  workspaceKey: "/work/acme",
  projectId: "proj_work_acme",
};

const SESSION: ZCodeSessionFacts = {
  sessionId: "sess_demo",
  taskId: "sess_demo",
  workspace: WORKSPACE,
};

const USER: ZCodeUserIdentity = {
  userId: "user-1",
  organizationId: null,
  loginProvider: "zai",
};

const fixedTime: TimePort = { now: () => NOW };

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-sidecar-test-"));
  dirs.push(dir);
  return dir;
}
// sidecar 测试文件内即时清理（避免跨文件目录堆积）。
function cleanup(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function taskCreatedEvent(sessionId = "sess_demo"): TaskCreatedEvent {
  return {
    sessionId,
    taskId: sessionId,
    workspace: WORKSPACE,
    occurredAt: NOW,
  };
}

/** 异步监听器（fire-and-forget）冲刷：setTimeout 宏任务前排空全部微任务。 */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function setup(options: { session?: ZCodeSessionFacts | null; user?: ZCodeUserIdentity | null } = {}) {
  const sessionFacts = new InMemorySessionFactsPort({
    // 显式 null 必须保留（fail-closed 场景），只有 undefined 才取默认。
    session: options.session === undefined ? SESSION : options.session,
    user: options.user === undefined ? USER : options.user,
  });
  const store = new MissionStore({ directory: newDir(), time: fixedTime });
  const sidecar = new MissionSidecarService();
  const attachment = sidecar.attachToSessionFacts({
    sessionFacts,
    identityBridge: new IdentityBridgeService({ sessionFacts }),
    store,
    time: fixedTime,
  });
  return { sessionFacts, store, sidecar, attachment };
}

/** 保存必炸的存储（graceful-failure 注入）：listMissions 正常，saveMission 抛错。 */
class ThrowingMissionStore extends MissionStore {
  saveMission(_tenantId: string, _mission: Mission): Mission {
    throw new Error("simulated disk failure");
  }
}

describe("MissionSidecarService (graceful failure)", () => {
  test("creates a linked mission sidecar after a task-created event when tenant is resolvable", async () => {
    const { sessionFacts, store, attachment } = setup();
    sessionFacts.emitTaskCreated(taskCreatedEvent());
    await flush();

    const missions = store.listMissions(TENANT);
    expect(missions).toHaveLength(1);
    const [mission] = missions;
    // objective 只是事件事实标记（真实目标由组合层后续补充），绝不编造营销内容。
    expect(mission?.objective).toBe("[mos] Mission sidecar for task sess_demo");
    expect(mission?.source_zcode_session_id).toBe("sess_demo");
    expect(mission?.source_zcode_task_id).toBe("sess_demo");
    expect(mission?.tenant_id).toBe(TENANT);
    expect(mission?.status).toBe("active");
    attachment.dispose();
    cleanup();
  });

  test("no mission and no throw when identity is unavailable (reason recorded in lastErrors)", async () => {
    const { sessionFacts, store, sidecar, attachment } = setup({ user: null });
    expect(() => sessionFacts.emitTaskCreated(taskCreatedEvent())).not.toThrow();
    await flush();

    expect(store.listMissions(TENANT)).toEqual([]);
    const errors = sidecar.lastErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.stage).toBe("resolve_tenant");
    expect(errors[0]?.message).toContain("user_identity_missing");
    attachment.dispose();
    cleanup();
  });

  test("no throw when the store save fails; failure is recorded in lastErrors", async () => {
    const sessionFacts = new InMemorySessionFactsPort({ session: SESSION, user: USER });
    const store = new ThrowingMissionStore({ directory: newDir(), time: fixedTime });
    const sidecar = new MissionSidecarService();
    const attachment = sidecar.attachToSessionFacts({
      sessionFacts,
      identityBridge: new IdentityBridgeService({ sessionFacts }),
      store,
      time: fixedTime,
    });

    expect(() => sessionFacts.emitTaskCreated(taskCreatedEvent())).not.toThrow();
    await flush();

    const errors = sidecar.lastErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.stage).toBe("persist_mission");
    expect(errors[0]?.message).toContain("simulated disk failure");
    attachment.dispose();
    cleanup();
  });

  test("dispose stops handling task-created events", async () => {
    const { sessionFacts, store, attachment } = setup();
    attachment.dispose();
    sessionFacts.emitTaskCreated(taskCreatedEvent());
    await flush();

    expect(store.listMissions(TENANT)).toEqual([]);
    cleanup();
  });

  test("duplicate task-created events for the same session are suppressed (idempotent)", async () => {
    const { sessionFacts, store, attachment } = setup();
    sessionFacts.emitTaskCreated(taskCreatedEvent());
    await flush();
    sessionFacts.emitTaskCreated(taskCreatedEvent());
    await flush();

    const missions = store.listMissions(TENANT, { source_zcode_session_id: "sess_demo" });
    expect(missions).toHaveLength(1);
    attachment.dispose();
    cleanup();
  });

  test("a port without observeTaskCreated attaches as a no-op (sidecar absent, task path untouched)", () => {
    const bare: SessionFactsPort = {
      currentSession: async () => SESSION,
      currentUser: async () => USER,
    };
    const store = new MissionStore({ directory: newDir(), time: fixedTime });
    const sidecar = new MissionSidecarService();
    const attachment = sidecar.attachToSessionFacts({
      sessionFacts: bare,
      identityBridge: new IdentityBridgeService({ sessionFacts: bare }),
      store,
      time: fixedTime,
    });
    expect(typeof attachment.dispose).toBe("function");
    expect(() => attachment.dispose()).not.toThrow();
    expect(store.listMissions(TENANT)).toEqual([]);
    cleanup();
  });

  test("identity resolution that throws is recorded in lastErrors and never propagates", async () => {
    const sessionFacts = new InMemorySessionFactsPort({ session: SESSION, user: USER });
    const explodingBridge = new IdentityBridgeService({
      sessionFacts: {
        currentSession: () => Promise.reject(new Error("session facts unavailable")),
        currentUser: async () => USER,
      },
    });
    const store = new MissionStore({ directory: newDir(), time: fixedTime });
    const sidecar = new MissionSidecarService();
    const attachment = sidecar.attachToSessionFacts({
      sessionFacts,
      identityBridge: explodingBridge,
      store,
      time: fixedTime,
    });

    expect(() => sessionFacts.emitTaskCreated(taskCreatedEvent())).not.toThrow();
    await flush();

    expect(store.listMissions(TENANT)).toEqual([]);
    const errors = sidecar.lastErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.stage).toBe("resolve_tenant");
    expect(errors[0]?.message).toContain("session facts unavailable");
    attachment.dispose();
    cleanup();
  });
});
