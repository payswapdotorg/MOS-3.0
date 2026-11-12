import { describe, expect, test } from "vitest";
import { InMemorySessionFactsPort, type ZCodeSessionFacts, type ZCodeUserIdentity } from "@mos/adapters";
import { tenantContextSchema } from "@mos/contracts";
import { IdentityBridgeService, resolveTenantContext } from "../src/index.js";

const WORKSPACE = {
  workspacePath: "/work/acme",
  workspaceIdentity: null,
  workspaceKey: "/work/acme",
  projectId: "proj_work_acme",
};

const SESSION: ZCodeSessionFacts = {
  sessionId: "sess_demo",
  taskId: "sess_demo",
  workspace: WORKSPACE,
};

const USER: ZCodeUserIdentity = {
  userId: "user-1",
  organizationId: null,
  loginProvider: "zai",
};

describe("tenant context mapping", () => {
  test("resolves a full TenantContext from complete facts", () => {
    const context = resolveTenantContext(SESSION, USER);
    expect(context).not.toBeNull();
    expect(context?.tenant_id).toBe("/work/acme");
    expect(context?.workspace_id).toBe("proj_work_acme");
    expect(context?.actor_id).toBe("user-1");
    expect(context?.brand_id).toBeNull();
    expect(context?.source_zcode_session_id).toBe("sess_demo");
  });

  test("mapped context validates against the core contract schema", () => {
    const context = resolveTenantContext(SESSION, USER);
    expect(() => tenantContextSchema.parse(context)).not.toThrow();
  });

  test("remote workspace identity becomes the tenant id", () => {
    const remoteSession: ZCodeSessionFacts = {
      sessionId: "sess_remote",
      taskId: "sess_remote",
      workspace: {
        workspacePath: "/srv/acme",
        workspaceIdentity: "remote:ssh:build:22:dev:/srv/acme",
        workspaceKey: "remote:ssh:build:22:dev:/srv/acme",
        projectId: null,
      },
    };
    const context = resolveTenantContext(remoteSession, USER);
    expect(context?.tenant_id).toBe("remote:ssh:build:22:dev:/srv/acme");
    expect(context?.workspace_id).toBe("remote:ssh:build:22:dev:/srv/acme");
  });

  test("fails closed when session or workspace facts are missing", () => {
    expect(resolveTenantContext(null, USER)).toBeNull();
    expect(resolveTenantContext({ ...SESSION, workspace: null }, USER)).toBeNull();
  });

  test("fails closed when user identity is missing", () => {
    expect(resolveTenantContext(SESSION, null)).toBeNull();
    expect(resolveTenantContext(SESSION, { userId: null, organizationId: null, loginProvider: null })).toBeNull();
  });

  test("service reports structured unavailable reasons without throwing", async () => {
    const bridge = new IdentityBridgeService({
      sessionFacts: new InMemorySessionFactsPort({ session: SESSION, user: USER }),
    });
    const resolved = await bridge.resolveTenantContext();
    expect(resolved.status).toBe("resolved");

    const noUser = new IdentityBridgeService({
      sessionFacts: new InMemorySessionFactsPort({ session: SESSION, user: null }),
    });
    expect(await noUser.resolveTenantContext()).toEqual({
      status: "unavailable",
      reason: "user_identity_missing",
    });

    const noSession = new IdentityBridgeService({
      sessionFacts: new InMemorySessionFactsPort({ session: null, user: USER }),
    });
    expect(await noSession.resolveTenantContext()).toEqual({
      status: "unavailable",
      reason: "session_facts_missing",
    });
  });
});
