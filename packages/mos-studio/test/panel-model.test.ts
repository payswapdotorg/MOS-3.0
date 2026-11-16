import { describe, expect, test } from "vitest";
import {
  initialPanelState,
  panelReducer,
  unwrapError,
  unwrapItems,
  type PanelAction,
  TOOL_NAMES,
} from "../src/ui/model.js";

/** 面板状态机（纯函数）：转换、密钥清除与结构化解包。 */

function reduce(actions: PanelAction[]) {
  return actions.reduce(panelReducer, initialPanelState);
}

describe("panelReducer", () => {
  test("field updates keep other state", () => {
    const state = reduce([
      { type: "field", name: "operatorInput", value: "operator@example.test" },
      { type: "field", name: "readQuery", value: "hn search" },
    ]);
    expect(state.operatorInput).toBe("operator@example.test");
    expect(state.readQuery).toBe("hn search");
    expect(state.intakeInput).toBe("");
  });

  test("busy toggles without dropping data", () => {
    const state = reduce([
      { type: "field", name: "apiKeyInput", value: "secret-material" },
      { type: "busy", label: "connect" },
    ]);
    expect(state.busy).toBe("connect");
    expect(state.apiKeyInput).toBe("secret-material");
    const settled = panelReducer(state, { type: "busy", label: null });
    expect(settled.busy).toBeNull();
    expect(settled.apiKeyInput).toBe("secret-material");
  });

  test("clearSecrets wipes api key input only", () => {
    const state = reduce([
      { type: "field", name: "apiKeyInput", value: "secret-material" },
      { type: "field", name: "readQuery", value: "q" },
      { type: "clearSecrets" },
    ]);
    expect(state.apiKeyInput).toBe("");
    expect(state.readQuery).toBe("q");
  });

  test("error clears busy", () => {
    const state = reduce([
      { type: "busy", label: "read" },
      { type: "error", message: "boom" },
    ]);
    expect(state.error).toBe("boom");
    expect(state.busy).toBeNull();
  });

  test("status/missions/capabilities/routes/read replace state slices", () => {
    const state = reduce([
      {
        type: "status",
        status: {
          operator_configured: true,
          tenant: "tenant-1",
          session: "sess_1",
          workspace_key: "/w",
          mission: null,
          connections: [],
          availability: { available: false, reason: "no_mission" },
        },
      },
      { type: "missions", missions: [{ id: "m1", status: "active", objective: "o", source_zcode_session_id: "sess_1", created_at: "t" }] },
      {
        type: "capabilities",
        capabilities: [
          {
            capability_id: "research.discussion.search",
            implementation_id: "impl",
            status: "available",
            support_status: "supported",
            missing_preconditions: [],
            tool_mapping_verified: true,
          },
        ],
      },
      { type: "routes", routes: { mission_id: "m1", routes: [], summary: { existing: 0 } } },
      {
        type: "read",
        outcome: { status: "blocked", reason: "credential_missing", missing_preconditions: [] },
      },
    ]);
    expect(state.status?.operator_configured).toBe(true);
    expect(state.missions).toHaveLength(1);
    expect(state.capabilities[0]?.status).toBe("available");
    expect(state.routes?.mission_id).toBe("m1");
    expect(state.readOutcome?.status).toBe("blocked");
  });
});


describe("Lab & draft actions (Issue #31)", () => {
  test("evidence / researchNotes / hypotheses / briefs actions replace state slices and clear busy", () => {
    const actions: PanelAction[] = [
      {
        type: "evidence",
        evidence: [
          {
            id: "e1",
            mission_id: null,
            kind: "provider_response",
            observed_via: "composio-session-mcp",
            tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
            observed_at: "2026-11-16T12:00:00.000Z",
            query: "q",
            facts: {},
          },
        ],
      },
      { type: "researchNotes", notes: [{ id: "n1", topic: "t", findings: [], insight: null, confidence: null, limitations: [], created_at: "x", mission_id: null }] },
      { type: "hypotheses", hypotheses: [{ id: "h1", statement: "s", mission_id: "m1", rationale: null, evidence_refs: [], proposed_route_ids: [], status: "proposed", created_at: "x" }] },
      { type: "briefs", briefs: [{ id: "b1", mission_id: "m1", title: "t", summary: "s", operator_notes: null, evidence_refs: [], research_note_ids: [], hypothesis_ids: [], route_summary: null, created_at: "x", artifact: { id: "a1", version: 1, quality_status: "unreviewed", rights_status: "unknown" }, review: null }] },
    ];
    const state = actions.reduce(panelReducer, { ...initialPanelState, busy: "lab" });
    expect(state.evidence).toHaveLength(1);
    expect(state.researchNotes[0]?.id).toBe("n1");
    expect(state.hypotheses[0]?.status).toBe("proposed");
    expect(state.briefs[0]?.artifact.version).toBe(1);
    expect(state.busy).toBeNull();
  });

  test("new lab/draft form fields are editable via the field action", () => {
    let state = initialPanelState;
    state = panelReducer(state, { type: "field", name: "noteTopicInput", value: "topic" });
    state = panelReducer(state, { type: "field", name: "noteEvidenceRefInput", value: "e1" });
    state = panelReducer(state, { type: "field", name: "noteStatementInput", value: "fact" });
    state = panelReducer(state, { type: "field", name: "hypothesisStatementInput", value: "hypo" });
    state = panelReducer(state, { type: "field", name: "briefTitleInput", value: "title" });
    state = panelReducer(state, { type: "field", name: "briefSummaryInput", value: "summary" });
    state = panelReducer(state, { type: "field", name: "briefEvidenceInput", value: "e1 e2" });
    expect(state.noteTopicInput).toBe("topic");
    expect(state.noteEvidenceRefInput).toBe("e1");
    expect(state.noteStatementInput).toBe("fact");
    expect(state.hypothesisStatementInput).toBe("hypo");
    expect(state.briefTitleInput).toBe("title");
    expect(state.briefSummaryInput).toBe("summary");
    expect(state.briefEvidenceInput).toBe("e1 e2");
  });

  test("TOOL_NAMES covers the full Lab -> Draft workflow", () => {
    expect(TOOL_NAMES.listEvidence).toBe("mos_list_evidence");
    expect(TOOL_NAMES.recordResearchNote).toBe("mos_record_research_note");
    expect(TOOL_NAMES.listResearchNotes).toBe("mos_list_research_notes");
    expect(TOOL_NAMES.proposeHypothesis).toBe("mos_propose_hypothesis");
    expect(TOOL_NAMES.listHypotheses).toBe("mos_list_hypotheses");
    expect(TOOL_NAMES.composeDraftBrief).toBe("mos_compose_draft_brief");
    expect(TOOL_NAMES.listDraftBriefs).toBe("mos_list_draft_briefs");
    expect(TOOL_NAMES.reviewDraftBrief).toBe("mos_review_draft_brief");
  });
});

describe("unwrap helpers", () => {
  test("unwrapItems reads server {items} wrapping for arrays", () => {
    expect(unwrapItems({ items: [{ id: "a" }, { id: "b" }] })).toEqual([{ id: "a" }, { id: "b" }]);
    expect(unwrapItems("nope" as unknown)).toEqual([]);
    expect(unwrapItems(null)).toEqual([]);
  });

  test("unwrapError reads string and object errors", () => {
    expect(unwrapError({ error: "StudioTenantUnavailableError: x" })).toBe(
      "StudioTenantUnavailableError: x",
    );
    expect(unwrapError({ error: { message: "deep" } })).toBe("deep");
    expect(unwrapError({ ok: true })).toBeNull();
    expect(unwrapError(null)).toBeNull();
  });
});
