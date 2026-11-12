/**
 * contract.example.ts —— 身份桥使用样例。
 */
import { InMemorySessionFactsPort } from "@mos/adapters";
import { IdentityBridgeService, resolveTenantContext } from "./index.js";

/** 完整事实 → TenantContext 解析。 */
export function exampleResolveTenantContext() {
  return resolveTenantContext(
    {
      sessionId: "sess_demo",
      taskId: "sess_demo",
      workspace: {
        workspacePath: "/work/acme",
        workspaceIdentity: null,
        workspaceKey: "/work/acme",
        projectId: "proj_work_acme",
      },
    },
    { userId: "user-1", organizationId: null, loginProvider: "zai" },
  );
}

/** 经端口解析；事实缺失时 fail-closed 返回 unavailable，而不是抛异常。 */
export async function exampleIdentityBridgeService() {
  const bridge = new IdentityBridgeService({
    sessionFacts: new InMemorySessionFactsPort({
      session: {
        sessionId: "sess_demo",
        taskId: "sess_demo",
        workspace: {
          workspacePath: "/work/acme",
          workspaceIdentity: "remote:ssh:build:22:dev:/srv/acme",
          workspaceKey: "remote:ssh:build:22:dev:/srv/acme",
          projectId: null,
        },
      },
      user: { userId: "user-1", organizationId: null, loginProvider: "zai" },
    }),
  });
  return bridge.resolveTenantContext();
}
