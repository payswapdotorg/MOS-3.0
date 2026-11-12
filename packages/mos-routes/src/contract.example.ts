/**
 * contract.example.ts —— mos-routes 使用样例（组合根视角；无 console、无副作用）。
 */
import type { CapabilityInstance, SideEffect } from "@mos/contracts";
import type { TimePort } from "@mos/capabilities/contract";
import { missionFromIntake } from "@mos/missions";
import { evaluateRouteCandidates } from "./domain/evaluate-route.js";
import { RouteService } from "./application/route-service.js";
import type { RouteInstanceFact } from "./contract/route-input.js";

const NOW = "2026-11-12T00:00:00Z";

/** 评估输入的 Mission 由 @mos/missions 逐字 intake 产生（组合根职责）。 */
export function exampleMission() {
  return missionFromIntake(
    {
      tenant_id: "tenant-acme",
      workspace_id: "proj_work_acme",
      objective_verbatim:
        "Find a way to increase qualified inbound leads for our service business over the next 90 days.",
      source_zcode_session_id: "sess_demo",
      source_zcode_task_id: "sess_demo",
      target_audience: null,
      geography: null,
      desired_outcomes: [],
      success_metrics: [],
      budget: null,
      deadline: null,
    },
    { now: NOW, id: "mos-mission-example-1" },
  );
}

/**
 * 账户能力事实：已解析实例（来自 @mos/capabilities 解析器）+ 描述符声明的副作用
 * （组合根从描述符 sideEffect 配对带来；路由评估绝不从 id 猜副作用）。
 */
export function exampleAvailableReadFact(): RouteInstanceFact {
  const instance: CapabilityInstance = {
    id: "ci:tenant-acme:crm.contacts.read:conn-1",
    tenant_id: "tenant-acme",
    connection_id: "conn-1",
    capability_id: "crm.contacts.read",
    implementation_id: "impl-hubspot-contacts-read",
    support_status: "supported",
    status: "available",
    available_quota: null,
    constraints: [],
    missing_preconditions: [],
    checked_at: NOW,
    evidence_refs: ["spec/integrations/provider-evidence/hubspot-connector-evidence.md"],
  };
  const sideEffect: SideEffect = "read";
  return { instance, side_effect: sideEffect };
}

/** 直接调用领域评估器（自带确定性 seed：同一 (mission, seed) 重评估可对账）。 */
export function exampleEvaluateRouteCandidates() {
  return evaluateRouteCandidates({
    mission: exampleMission(),
    capabilityInstances: [exampleAvailableReadFact()],
    now: NOW,
    idSeed: 1,
  });
}

/** 经服务封装（注入时钟；available+read → existing，无审批绑定）。 */
export function exampleRouteService() {
  const clock: TimePort = { now: () => NOW };
  const service = new RouteService({ time: clock });
  return service.candidatesForMission(exampleMission(), [
    exampleAvailableReadFact(),
    {
      // 同一能力、另一条连接：缺 scope → conditional（preconditions 逐字抄录）。
      instance: {
        ...exampleAvailableReadFact().instance,
        id: "ci:tenant-acme:crm.contacts.read:conn-2",
        connection_id: "conn-2",
        status: "unavailable",
        missing_preconditions: ["scope:crm.objects.contacts.read"],
      },
      side_effect: "read",
    },
  ]);
}
