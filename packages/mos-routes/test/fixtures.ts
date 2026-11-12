import type { CapabilityInstance, Mission, SideEffect } from "@mos/contracts";
import { missionFromIntake } from "@mos/missions";
import type { MissionIntake } from "@mos/missions";
import type { RouteInstanceFact } from "../src/index.js";

/** 测试夹具：W1 第一条能力（HubSpot 联系人读）的最小合法事实集。 */

export const NOW = "2026-11-12T00:00:00Z";
export const TENANT = "tenant-acme";
export const WORKSPACE = "proj_work_acme";
export const EVIDENCE_REF =
  "spec/integrations/provider-evidence/hubspot-connector-evidence.md";
export const MISSION_ID = "mos-mission-fixture";

export function baseMission(overrides: Partial<Mission> = {}): Mission {
  const intake: MissionIntake = {
    tenant_id: TENANT,
    workspace_id: WORKSPACE,
    objective_verbatim:
      "Increase qualified inbound leads for our service business over the next 90 days.",
    source_zcode_session_id: null,
    source_zcode_task_id: null,
    target_audience: null,
    geography: null,
    desired_outcomes: [],
    success_metrics: [],
    budget: null,
    deadline: null,
  };
  return {
    ...missionFromIntake(intake, { now: NOW, id: MISSION_ID }),
    ...overrides,
  };
}

export function baseInstance(overrides: Partial<CapabilityInstance> = {}): CapabilityInstance {
  return {
    id: "ci:tenant-acme:crm.contacts.read:conn-1",
    tenant_id: TENANT,
    connection_id: "conn-1",
    capability_id: "crm.contacts.read",
    implementation_id: "impl-hubspot-contacts-read",
    support_status: "supported",
    status: "available",
    available_quota: null,
    constraints: [],
    missing_preconditions: [],
    checked_at: NOW,
    evidence_refs: [EVIDENCE_REF],
    ...overrides,
  };
}

export function fact(
  instance: CapabilityInstance,
  sideEffect: SideEffect,
): RouteInstanceFact {
  return { instance, side_effect: sideEffect };
}
