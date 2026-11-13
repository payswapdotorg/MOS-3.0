/**
 * contract.example.ts —— mos-lab 使用样例（组合根视角；无 console、无副作用）。
 * 全部外部记录（mission/route/offer）经结构化 lookup 端口注入——本包不 import
 * @mos/missions、@mos/routes、@mos/agent-organizations（决策锁 #8/#9）。
 */
import type {
  EvidenceKind,
  Mission,
  NodeOffer,
  Route,
} from "@mos/contracts";
import { researchNoteFromIntake } from "./domain/research-note.js";
import { ResearchNoteStore } from "./application/research-note-store.js";
import { HypothesisStore } from "./application/hypothesis-store.js";
import { ProgramDiscoveryService } from "./application/program-discovery-service.js";
import type { EvidenceLookup } from "./contract/research.js";
import type { RouteCandidateFact } from "./contract/program-discovery.js";
import type { TimePort } from "./contract/lab-vocabulary.js";

const NOW = "2026-11-13T00:00:00Z";
const TENANT = "tenant-acme";

/** 组合根注入的时钟（任何 { now(): string } 实现均可——结构化满足）。 */
const clock: TimePort = { now: () => NOW };

/** 组合根注入的 evidenceLookup：接到 evidence 存储（此处为示例内存映射）。 */
const evidenceKinds = new Map<string, EvidenceKind>([
  ["evidence:hubspot-contacts-export", "provider_response"],
  ["evidence:web-analytics-week-46", "analytics_event"],
]);
const evidenceLookup: EvidenceLookup = (ref) => {
  const kind = evidenceKinds.get(ref);
  return kind === undefined ? undefined : { kind };
};

/** 研究笔记：逐字 intake → ResearchNoteStore（evidence 门禁在写边界）。 */
export function exampleResearchNote() {
  const store = new ResearchNoteStore({
    directory: "/tmp/mos-lab-example",
    evidenceLookup,
  });
  const note = researchNoteFromIntake(
    {
      tenant_id: TENANT,
      mission_id: "mos-mission-example-1",
      topic: "Inbound lead intent gaps",
      findings: [
        {
          evidence_ref: "evidence:hubspot-contacts-export",
          statement: "Contact-form submissions mention pricing 3x more than demos.",
        },
      ],
      insight: null,
      confidence: null,
      limitations: [],
    },
    { now: NOW, id: "research-note-example-1" },
  );
  return store.saveNote(TENANT, note);
}

/** 组合根注入的 missionLookup：接到 mission 存储（示例返回固定记录）。 */
const exampleMission: Mission = {
  id: "mos-mission-example-1",
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
};
const missionLookup = (tenantId: string, missionId: string) =>
  missionId === exampleMission.id && tenantId === TENANT ? exampleMission : undefined;

/** 假设提案：missionLookup 门禁 + 创建恒为 proposed / experiment_ref null（决策锁 #18）。 */
export function exampleHypothesis() {
  const store = new HypothesisStore({
    directory: "/tmp/mos-lab-example",
    missionLookup,
  });
  return store.proposeHypothesis(
    TENANT,
    {
      tenant_id: TENANT,
      mission_id: exampleMission.id,
      statement: "Publishing pricing pages increases qualified inbound leads.",
      rationale: "Research findings mention pricing uncertainty as the bottleneck.",
      evidence_refs: ["evidence:hubspot-contacts-export"],
      proposed_route_ids: ["route:mos-mission-example-1:1:1"],
    },
    { now: NOW, id: "hypothesis-example-1" },
  );
}

/** 组合根注入的 routeLookup：Route 记录 + 组合根解析好的 capability_ids 配对。 */
const exampleRoute: Route = {
  id: "route:mos-mission-example-1:1:1",
  tenant_id: TENANT,
  mission_id: exampleMission.id,
  route_class: "existing",
  status: "candidate",
  steps: [
    {
      description: "Draft pricing copy",
      capability_instance_id: "ci:tenant-acme:marketing.copywriting:conn-1",
      side_effect: "create",
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
};
const routeFact: RouteCandidateFact = {
  route: exampleRoute,
  // 组合根从 steps 的 capability_instance_id 解析配对（lab 绝不猜测）。
  capability_ids: ["marketing.copywriting"],
};
const routeLookup = (tenantId: string, routeId: string) =>
  routeId === exampleRoute.id && tenantId === TENANT ? routeFact : undefined;

/** 组合根注入的 offerLookup：接到 offer 存储（示例返回固定记录）。 */
const exampleOffer: NodeOffer = {
  id: "offer:copywriting:1",
  tenant_id: TENANT,
  node_ref: { kind: "human", id: "node:copywriter-1" },
  capability_id: "marketing.copywriting",
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
};
const offerLookup = (tenantId: string, capabilityId: string) =>
  capabilityId === exampleOffer.capability_id && tenantId === TENANT ? [exampleOffer] : [];

/** 程序发现：既有记录 → 只引用 route/offer 的 lab program suggestions。 */
export function exampleProgramDiscovery() {
  const hypothesis = exampleHypothesis();
  const service = new ProgramDiscoveryService({
    time: clock,
    missionLookup,
    hypothesisLookup: (tenantId, hypothesisId) =>
      hypothesisId === hypothesis.id && tenantId === TENANT ? hypothesis : undefined,
    routeLookup,
    offerLookup,
  });
  return service.discover({
    tenant_id: TENANT,
    mission_id: exampleMission.id,
    hypothesis_ids: [hypothesis.id],
  });
}
