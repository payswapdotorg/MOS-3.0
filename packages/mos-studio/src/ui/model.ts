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

export interface PanelState {
  readonly status: StatusView | null;
  readonly missions: readonly MissionRow[];
  readonly capabilities: readonly CapabilityRow[];
  readonly routes: RoutesView | null;
  readonly readOutcome: ReadOutcomeView | null;
  readonly busy: string | null;
  readonly error: string | null;
  readonly operatorInput: string;
  readonly intakeInput: string;
  readonly readQuery: string;
  readonly apiKeyInput: string;
}

export const initialPanelState: PanelState = {
  status: null,
  missions: [],
  capabilities: [],
  routes: null,
  readOutcome: null,
  busy: null,
  error: null,
  operatorInput: "",
  intakeInput: "",
  readQuery: "",
  apiKeyInput: "",
};

export type PanelAction =
  | { readonly type: "busy"; readonly label: string | null }
  | { readonly type: "error"; readonly message: string | null }
  | { readonly type: "status"; readonly status: StatusView }
  | { readonly type: "missions"; readonly missions: readonly MissionRow[] }
  | { readonly type: "capabilities"; readonly capabilities: readonly CapabilityRow[] }
  | { readonly type: "routes"; readonly routes: RoutesView }
  | { readonly type: "read"; readonly outcome: ReadOutcomeView }
  | { readonly type: "field"; readonly name: "operatorInput" | "intakeInput" | "readQuery" | "apiKeyInput"; readonly value: string }
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
} as const;
