import type {
  EvidenceKind,
  Hypothesis,
  Mission,
  NodeOffer,
  ResearchNote,
  Route,
  SideEffect,
} from "@mos/contracts";
import { researchNoteFromIntake } from "../src/index.js";
import { hypothesisFromProposal } from "../src/index.js";
import type {
  EvidenceLookup,
  ResearchNoteIntake,
} from "../src/index.js";
import type { HypothesisProposal } from "../src/index.js";

/**
 * 测试夹具：mos-lab 最小合法事实集（本包不得 import @mos/missions 等模块——
 * mission/route/offer 记录按契约 schema 逐字构造，与组合根注入的记录同形）。
 */

export const NOW = "2026-11-13T00:00:00Z";
export const T1 = "2026-11-13T00:00:00Z";
export const T2 = "2026-11-13T01:00:00Z";
export const TENANT = "tenant-acme";
export const OTHER_TENANT = "tenant-globex";
export const MISSION_ID = "mos-mission-fixture";
export const EVIDENCE_REF = "evidence:hubspot-contacts-export";
export const STORE_NOTES_FILE = "mos-research-notes.json";
export const STORE_HYPOTHESES_FILE = "mos-hypotheses.json";

export const CAP_COPYWRITING = "marketing.copywriting";
export const CAP_DESIGN = "marketing.design";

/** evidenceLookup 端口的内存 fake：预置三种非 simulation 证据 + 一条 simulation 证据。 */
const EVIDENCE_KINDS: ReadonlyMap<string, EvidenceKind> = new Map([
  [EVIDENCE_REF, "provider_response"],
  ["evidence:web-analytics-week-46", "analytics_event"],
  ["evidence:panel-notes", "human_review"],
  ["evidence:model-forecast", "simulation"],
]);

export const evidenceLookup: EvidenceLookup = (ref) => {
  const kind = EVIDENCE_KINDS.get(ref);
  return kind === undefined ? undefined : { kind };
};

export function baseMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: MISSION_ID,
    version: 1,
    tenant_id: TENANT,
    workspace_id: "proj_work_acme",
    objective: "Increase qualified inbound leads for our service business.",
    target_audience: null,
    geography: null,
    desired_outcomes: [],
    constraints: {},
    budget: null,
    deadline: null,
    success_metrics: [],
    source_zcode_session_id: null,
    source_zcode_task_id: null,
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function baseIntake(overrides: Partial<ResearchNoteIntake> = {}): ResearchNoteIntake {
  return {
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    topic: "Inbound lead intent gaps",
    findings: [],
    insight: null,
    confidence: null,
    limitations: [],
    ...overrides,
  };
}

export function baseNote(
  overrides: Partial<ResearchNote> = {},
  intakeOverrides: Partial<ResearchNoteIntake> = {},
): ResearchNote {
  return {
    ...researchNoteFromIntake(baseIntake(intakeOverrides), { now: T1, id: "note-1" }),
    ...overrides,
  };
}

export function baseProposal(
  overrides: Partial<HypothesisProposal> = {},
): HypothesisProposal {
  return {
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    statement: "Publishing pricing pages increases qualified inbound leads.",
    rationale: null,
    evidence_refs: [EVIDENCE_REF],
    proposed_route_ids: [],
    ...overrides,
  };
}

export function baseHypothesis(
  overrides: Partial<Hypothesis> = {},
  proposalOverrides: Partial<HypothesisProposal> = {},
): Hypothesis {
  return {
    ...hypothesisFromProposal(baseProposal(proposalOverrides), { now: T1, id: "hyp-1" }),
    ...overrides,
  };
}

export function baseRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: "route:mos-mission-fixture:1:1",
    tenant_id: TENANT,
    mission_id: MISSION_ID,
    route_class: "existing",
    status: "candidate",
    steps: [
      {
        description: "Draft pricing page copy",
        capability_instance_id: "ci:tenant-acme:marketing.copywriting:conn-1",
        side_effect: "create" as SideEffect,
      },
    ],
    preconditions: [],
    approvals: ["zcode_existing_permissions"],
    estimated_cost: null,
    estimated_latency_ms: null,
    confidence: null,
    evidence_refs: [],
    unknowns: [],
    risks: [],
    fallback_route_ids: [],
    ...overrides,
  };
}

export function baseOffer(overrides: Partial<NodeOffer> = {}): NodeOffer {
  return {
    id: "offer:copywriting:1",
    tenant_id: TENANT,
    node_ref: { kind: "human", id: "node:copywriter-1" },
    capability_id: CAP_COPYWRITING,
    inputs: ["brief"],
    deliverables: ["pricing page copy draft"],
    availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: "2 concurrent" },
    geography: "global",
    language: "en",
    price_reward: { amount: "120.00", currency: "USD" },
    deadline: "2026-12-01T00:00:00Z",
    sla: "48h first draft",
    rights_constraints: [],
    acceptance_evaluator: { evaluator_ref: "eval:copy-quality", method: "human review panel" },
    evidence_refs: ["spec/integrations/provider-evidence/hubspot-connector-evidence.md"],
    delivery_history: [],
    status: "published",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}
