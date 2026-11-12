/**
 * contract.example.ts —— mos-missions 使用样例（样例即文档；无 console、无副作用）。
 */
import { InMemorySessionFactsPort, SystemTimePort } from "@mos/adapters";
import { IdentityBridgeService } from "@mos/identity-bridge";
import type { DomainEvent } from "./contract.js";
import { missionFromIntake } from "./domain/intake.js";
import { MissionStore } from "./application/mission-store.js";
import { MissionSidecarService } from "./application/mission-sidecar.js";

/** 逐字 intake → Mission（零推断：objective 一字不改，缺失字段保持 null/[]）。 */
export function exampleMissionFromIntake() {
  return missionFromIntake(
    {
      tenant_id: "/work/acme",
      workspace_id: "proj_work_acme",
      objective_verbatim:
        "Find a way to increase qualified inbound leads for our service business over the next 90 days.",
      source_zcode_session_id: null,
      source_zcode_task_id: null,
      target_audience: null,
      geography: null,
      desired_outcomes: [],
      success_metrics: [],
      budget: null,
      deadline: null,
    },
    { now: "2026-11-12T00:00:00Z", id: "mos-mission-example-1" },
  );
}

/** tenant-scoped 持久存储（注入目录/时钟/事件监听；文件缺失时空启动）。 */
export function exampleMissionStore() {
  const events: DomainEvent[] = [];
  return new MissionStore({
    directory: ".mos/missions",
    time: new SystemTimePort(),
    eventSink: (event) => {
      events.push(event);
    },
    newEventId: () => `evt-${events.length + 1}`,
  });
}

/**
 * sidecar 附加（graceful failure）：订阅"标准任务创建成功"事实，
 * tenant 可解析时创建带会话/任务引用的 Mission sidecar；
 * 不可解析时静默缺席（原因只进 lastErrors，绝不抛入 ZCode 任务路径）。
 */
export function exampleAttachMissionSidecar() {
  const sessionFacts = new InMemorySessionFactsPort({
    session: {
      sessionId: "sess_demo",
      taskId: "sess_demo",
      workspace: {
        workspacePath: "/work/acme",
        workspaceIdentity: null,
        workspaceKey: "/work/acme",
        projectId: "proj_work_acme",
      },
    },
    user: { userId: "user-1", organizationId: null, loginProvider: "zai" },
  });
  const sidecar = new MissionSidecarService();
  return sidecar.attachToSessionFacts({
    sessionFacts,
    identityBridge: new IdentityBridgeService({ sessionFacts }),
    store: exampleMissionStore(),
    time: new SystemTimePort(),
  });
}
