import { describe, expect, test } from "vitest";
import {
  initialPanelState,
  panelReducer,
  unwrapError,
  unwrapItems,
  type PanelAction,
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
