/**
 * 旅程投影（纯函数）：把 @mos/* 的领域对象投影成面板/工具返回的展示形状。
 * 只投影、绝不改写领域对象；counts/shapes 优先，绝不复制 provider 记录内容。
 */
import type { CapabilityInstance } from "@mos/capabilities";
import type { ProviderConnection } from "@mos/contracts";
import type { Mission } from "@mos/missions";
import type { Route, RouteCandidateSummary } from "@mos/routes";

export interface MissionView {
  readonly id: string;
  readonly status: string;
  readonly objective: string;
  readonly source_zcode_session_id: string | null;
  readonly source_zcode_task_id: string | null;
  readonly created_at: string;
}

export function missionView(mission: Mission): MissionView {
  return {
    id: mission.id,
    status: mission.status,
    objective: mission.objective,
    source_zcode_session_id: mission.source_zcode_session_id ?? null,
    source_zcode_task_id: mission.source_zcode_task_id ?? null,
    created_at: mission.created_at,
  };
}

export interface ConnectionView {
  readonly id: string;
  readonly provider_id: string;
  readonly auth_method: string;
  readonly status: string;
  readonly credential_ref: string;
  readonly granted_scopes: readonly string[];
}

export function connectionView(connection: ProviderConnection): ConnectionView {
  return {
    id: connection.id,
    provider_id: connection.provider_id,
    auth_method: connection.auth_method,
    status: connection.status,
    credential_ref: connection.credential_ref,
    granted_scopes: [...connection.granted_scopes],
  };
}

export interface CapabilityInstanceView {
  readonly capability_id: string;
  readonly implementation_id: string;
  readonly status: string;
  readonly support_status: string;
  readonly missing_preconditions: readonly string[];
  readonly tool_mapping_verified: boolean;
}

export function capabilityInstanceView(
  instance: CapabilityInstance,
  toolMappingVerified: boolean,
): CapabilityInstanceView {
  return {
    capability_id: instance.capability_id,
    implementation_id: instance.implementation_id,
    status: instance.status,
    support_status: instance.support_status,
    missing_preconditions: [...instance.missing_preconditions],
    tool_mapping_verified: toolMappingVerified,
  };
}

export interface RouteView {
  readonly route_id: string;
  readonly route_class: string;
  readonly side_effect: string;
  readonly approvals: readonly string[];
  readonly unknowns: readonly string[];
}

export function routeView(route: Route): RouteView {
  return {
    route_id: route.id,
    route_class: route.route_class,
    side_effect: route.steps.map((step) => step.side_effect).join("|"),
    approvals: [...route.approvals],
    unknowns: [...route.unknowns],
  };
}

export interface RoutesView {
  readonly mission_id: string;
  readonly routes: readonly RouteView[];
  readonly summary: Record<string, number>;
}

export function routesView(
  missionId: string,
  routes: readonly Route[],
  summary: RouteCandidateSummary,
): RoutesView {
  return {
    mission_id: missionId,
    routes: routes.map(routeView),
    summary: {
      existing: summary.existing,
      conditional: summary.conditional,
      blocked: summary.blocked,
      unknown: summary.unknown,
      total: summary.total,
    },
  };
}

// ── Issue #31 Marketing Lab → Studio draft 投影（同样只投影、绝不改写） ──────────

export interface EvidenceView {
  readonly id: string;
  readonly mission_id: string | null;
  readonly kind: string;
  readonly observed_via: string;
  readonly tool: string;
  readonly observed_at: string;
  readonly query: string;
  readonly facts: Record<string, unknown>;
}

export function evidenceView(evidence: {
  id: string;
  mission_id: string | null;
  kind: string;
  observed_via: string;
  tool: string;
  observed_at: string;
  query: string;
  facts: Record<string, unknown>;
}): EvidenceView {
  return {
    id: evidence.id,
    mission_id: evidence.mission_id,
    kind: evidence.kind,
    observed_via: evidence.observed_via,
    tool: evidence.tool,
    observed_at: evidence.observed_at,
    query: evidence.query,
    facts: { ...evidence.facts },
  };
}

export interface ResearchNoteView {
  readonly id: string;
  readonly mission_id: string | null;
  readonly topic: string;
  readonly findings: readonly { evidence_ref: string; statement: string }[];
  readonly insight: string | null;
  readonly confidence: number | null;
  readonly limitations: readonly string[];
  readonly created_at: string;
}

export function researchNoteView(note: {
  id: string;
  mission_id: string | null;
  topic: string;
  findings: readonly { evidence_ref: string; statement: string }[];
  insight: string | null;
  confidence: number | null;
  limitations: readonly string[];
  created_at: string;
}): ResearchNoteView {
  return {
    id: note.id,
    mission_id: note.mission_id,
    topic: note.topic,
    findings: note.findings.map((finding) => ({ ...finding })),
    insight: note.insight,
    confidence: note.confidence,
    limitations: [...note.limitations],
    created_at: note.created_at,
  };
}

export interface HypothesisView {
  readonly id: string;
  readonly mission_id: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly evidence_refs: readonly string[];
  readonly proposed_route_ids: readonly string[];
  readonly status: string;
  readonly created_at: string;
}

export function hypothesisView(hypothesis: {
  id: string;
  mission_id: string;
  statement: string;
  rationale: string | null;
  evidence_refs: readonly string[];
  proposed_route_ids: readonly string[];
  status: string;
  created_at: string;
}): HypothesisView {
  return {
    id: hypothesis.id,
    mission_id: hypothesis.mission_id,
    statement: hypothesis.statement,
    rationale: hypothesis.rationale,
    evidence_refs: [...hypothesis.evidence_refs],
    proposed_route_ids: [...hypothesis.proposed_route_ids],
    status: hypothesis.status,
    created_at: hypothesis.created_at,
  };
}

export interface DraftBriefReviewView {
  readonly decision: string;
  readonly decided_at: string;
  readonly note: string | null;
}

export interface DraftBriefView {
  readonly id: string;
  readonly mission_id: string;
  readonly title: string;
  readonly summary: string;
  readonly operator_notes: string | null;
  readonly evidence_refs: readonly string[];
  readonly research_note_ids: readonly string[];
  readonly hypothesis_ids: readonly string[];
  readonly route_summary: Record<string, unknown> | null;
  readonly created_at: string;
  readonly artifact: {
    readonly id: string;
    readonly version: number;
    readonly quality_status: string;
    readonly rights_status: string;
  };
  readonly review: DraftBriefReviewView | null;
}

export function draftBriefView(
  brief: {
    id: string;
    mission_id: string;
    title: string;
    summary: string;
    operator_notes: string | null;
    evidence_refs: readonly string[];
    research_note_ids: readonly string[];
    hypothesis_ids: readonly string[];
    route_summary: Record<string, unknown> | null;
    created_at: string;
    artifact_id: string;
  },
  artifact: {
    version: number;
    quality_status: string;
    rights_status: string;
  },
  review: DraftBriefReviewView | null,
): DraftBriefView {
  return {
    id: brief.id,
    mission_id: brief.mission_id,
    title: brief.title,
    summary: brief.summary,
    operator_notes: brief.operator_notes,
    evidence_refs: [...brief.evidence_refs],
    research_note_ids: [...brief.research_note_ids],
    hypothesis_ids: [...brief.hypothesis_ids],
    route_summary: brief.route_summary ? { ...brief.route_summary } : null,
    created_at: brief.created_at,
    artifact: {
      id: brief.artifact_id,
      version: artifact.version,
      quality_status: artifact.quality_status,
      rights_status: artifact.rights_status,
    },
    review,
  };
}
