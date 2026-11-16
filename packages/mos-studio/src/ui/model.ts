/**
 * 面板状态机（纯函数/纯类型；无 React、无 IO——可工程测试）。
 * 形状与服务端工具的 structuredContent 投影一致（server okResult 包装 {items} 或对象）。
 */

export interface AvailabilityView {
  readonly available: boolean;
  readonly reason: string | null;
}

export interface MissionRow {
  readonly id: string;
  readonly status: string;
  readonly objective: string;
  readonly source_zcode_session_id: string | null;
  readonly created_at: string;
}

export interface ConnectionRow {
  readonly id: string;
  readonly provider_id: string;
  readonly status: string;
  readonly credential_ref: string;
}

export interface CapabilityRow {
  readonly capability_id: string;
  readonly implementation_id: string;
  readonly status: string;
  readonly support_status: string;
  readonly missing_preconditions: readonly string[];
  readonly tool_mapping_verified: boolean;
}

export interface RouteRow {
  readonly route_id: string;
  readonly route_class: string;
  readonly side_effect: string;
}

export interface StatusView {
  readonly operator_configured: boolean;
  readonly tenant: string | null;
  readonly session: string | null;
  readonly workspace_key: string | null;
  readonly mission: MissionRow | null;
  readonly connections: readonly ConnectionRow[];
  readonly availability: AvailabilityView;
}

export interface RoutesView {
  readonly mission_id: string;
  readonly routes: readonly RouteRow[];
  readonly summary: Record<string, number>;
}

export type ReadOutcomeView =
  | {
      readonly status: "succeeded";
      readonly evidence_id: string | null;
      readonly evidence: {
        readonly observed_via: string;
        readonly tool: string;
        readonly connection_id: string;
        readonly observed_at: string;
        readonly facts: Record<string, unknown>;
      };
    }
  | { readonly status: "blocked"; readonly reason: string; readonly missing_preconditions: readonly string[] }
  | { readonly status: "failed"; readonly stage: string; readonly classified: string; readonly action: string };

// ── Issue #31 Marketing Lab → Studio draft 行形状（与服务端投影一致） ──────────

export interface EvidenceRow {
  readonly id: string;
  readonly mission_id: string | null;
  readonly kind: string;
  readonly observed_via: string;
  readonly tool: string;
  readonly observed_at: string;
  readonly query: string;
  readonly facts: Record<string, unknown>;
}

export interface ResearchNoteRow {
  readonly id: string;
  readonly mission_id: string | null;
  readonly topic: string;
  readonly findings: readonly { evidence_ref: string; statement: string }[];
  readonly insight: string | null;
  readonly confidence: number | null;
  readonly limitations: readonly string[];
  readonly created_at: string;
}

export interface HypothesisRow {
  readonly id: string;
  readonly mission_id: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly evidence_refs: readonly string[];
  readonly proposed_route_ids: readonly string[];
  readonly status: string;
  readonly created_at: string;
}

export interface DraftBriefRow {
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
  readonly review: { readonly decision: string; readonly decided_at: string; readonly note: string | null } | null;
}

export interface PanelState {
  readonly status: StatusView | null;
  readonly missions: readonly MissionRow[];
  readonly capabilities: readonly CapabilityRow[];
  readonly routes: RoutesView | null;
  readonly readOutcome: ReadOutcomeView | null;
  readonly evidence: readonly EvidenceRow[];
  readonly researchNotes: readonly ResearchNoteRow[];
  readonly hypotheses: readonly HypothesisRow[];
  readonly briefs: readonly DraftBriefRow[];
  readonly busy: string | null;
  readonly error: string | null;
  readonly operatorInput: string;
  readonly intakeInput: string;
  readonly readQuery: string;
  readonly apiKeyInput: string;
  readonly noteTopicInput: string;
  readonly noteEvidenceRefInput: string;
  readonly noteStatementInput: string;
  readonly noteInsightInput: string;
  readonly hypothesisStatementInput: string;
  readonly briefTitleInput: string;
  readonly briefSummaryInput: string;
  readonly briefEvidenceInput: string;
}

export const initialPanelState: PanelState = {
  status: null,
  missions: [],
  capabilities: [],
  routes: null,
  readOutcome: null,
  evidence: [],
  researchNotes: [],
  hypotheses: [],
  briefs: [],
  busy: null,
  error: null,
  operatorInput: "",
  intakeInput: "",
  readQuery: "",
  apiKeyInput: "",
  noteTopicInput: "",
  noteEvidenceRefInput: "",
  noteStatementInput: "",
  noteInsightInput: "",
  hypothesisStatementInput: "",
  briefTitleInput: "",
  briefSummaryInput: "",
  briefEvidenceInput: "",
};

export type PanelAction =
  | { readonly type: "busy"; readonly label: string | null }
  | { readonly type: "error"; readonly message: string | null }
  | { readonly type: "status"; readonly status: StatusView }
  | { readonly type: "missions"; readonly missions: readonly MissionRow[] }
  | { readonly type: "capabilities"; readonly capabilities: readonly CapabilityRow[] }
  | { readonly type: "routes"; readonly routes: RoutesView }
  | { readonly type: "read"; readonly outcome: ReadOutcomeView }
  | { readonly type: "evidence"; readonly evidence: readonly EvidenceRow[] }
  | { readonly type: "researchNotes"; readonly notes: readonly ResearchNoteRow[] }
  | { readonly type: "hypotheses"; readonly hypotheses: readonly HypothesisRow[] }
  | { readonly type: "briefs"; readonly briefs: readonly DraftBriefRow[] }
  | {
      readonly type: "field";
      readonly name:
        | "operatorInput"
        | "intakeInput"
        | "readQuery"
        | "apiKeyInput"
        | "noteTopicInput"
        | "noteEvidenceRefInput"
        | "noteStatementInput"
        | "noteInsightInput"
        | "hypothesisStatementInput"
        | "briefTitleInput"
        | "briefSummaryInput"
        | "briefEvidenceInput";
      readonly value: string;
    }
  | { readonly type: "clearSecrets" };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "busy":
      return { ...state, busy: action.label, error: action.label ? state.error : state.error };
    case "error":
      return { ...state, error: action.message, busy: null };
    case "status":
      return { ...state, status: action.status, busy: null };
    case "missions":
      return { ...state, missions: [...action.missions], busy: null };
    case "capabilities":
      return { ...state, capabilities: [...action.capabilities], busy: null };
    case "routes":
      return { ...state, routes: action.routes, busy: null };
    case "read":
      return { ...state, readOutcome: action.outcome, busy: null };
    case "evidence":
      return { ...state, evidence: [...action.evidence], busy: null };
    case "researchNotes":
      return { ...state, researchNotes: [...action.notes], busy: null };
    case "hypotheses":
      return { ...state, hypotheses: [...action.hypotheses], busy: null };
    case "briefs":
      return { ...state, briefs: [...action.briefs], busy: null };
    case "field":
      return { ...state, [action.name]: action.value };
    case "clearSecrets":
      // 授权材料只在提交瞬间的工具参数里流动；提交后立即从面板状态清除。
      return { ...state, apiKeyInput: "" };
  }
}

/** 工具返回的结构化包装（server okResult：数组包 {items}）。 */
export function unwrapItems<T>(value: unknown): readonly T[] {
  if (value && typeof value === "object" && "items" in value && Array.isArray((value as { items: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

export function unwrapError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  }
  return null;
}

export const TOOL_NAMES = {
  status: "mos_studio_status",
  setOperator: "mos_set_operator",
  listMissions: "mos_list_missions",
  recordIntake: "mos_record_mission_intake",
  connectComposio: "mos_connect_composio",
  capabilities: "mos_capabilities",
  routes: "mos_routes",
  executeRead: "mos_execute_authorized_read",
  listEvidence: "mos_list_evidence",
  recordResearchNote: "mos_record_research_note",
  listResearchNotes: "mos_list_research_notes",
  proposeHypothesis: "mos_propose_hypothesis",
  listHypotheses: "mos_list_hypotheses",
  composeDraftBrief: "mos_compose_draft_brief",
  listDraftBriefs: "mos_list_draft_briefs",
  reviewDraftBrief: "mos_review_draft_brief",
} as const;
