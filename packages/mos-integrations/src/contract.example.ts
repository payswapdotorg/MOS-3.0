/**
 * contract.example.ts —— provider 连接与读适配器的使用样例（样例即文档）。
 * 全部为组合根视角：端口注入、tenant 来自身份桥、模板未被安装。
 */
import { InMemoryProviderPort, SystemTimePort } from "@mos/adapters";
import { InMemorySessionFactsPort, type TimePort } from "@mos/adapters";
import { IdentityBridgeService } from "@mos/identity-bridge";
import { loadHubSpotConnectorTemplate } from "./connector/hubspot-connector-declaration.js";
import { HUBSPOT_SEARCH_CONTACTS_TOOL, hubspotProviderDescriptor } from "./contract/hubspot-descriptor.js";
import { ConnectionStore } from "./application/connection-store.js";
import { HubSpotReadAdapter } from "./application/read-adapter.js";

/**
 * tenant 事实 → 连接写入：tenant_id 只允许来自身份桥解析出的 TenantContext。
 * credential_ref 指向 ZCode 凭据存储（mcp:oauth:<24hex>），绝不内联令牌值。
 */
export async function exampleTenantScopedConnection(directory: string) {
  const bridge = new IdentityBridgeService({
    sessionFacts: new InMemorySessionFactsPort({
      session: {
        sessionId: "sess_demo",
        taskId: "sess_demo",
        workspace: {
          workspacePath: "/work/acme",
          workspaceIdentity: null,
          workspaceKey: "/work/acme",
          projectId: "proj_work_acme",
        },
      },
      user: { userId: "user-1", organizationId: null, loginProvider: "zai" },
    }),
  });
  const resolution = await bridge.resolveTenantContext();
  if (resolution.status !== "resolved") return resolution;

  const store = new ConnectionStore({ directory });
  return store.upsertConnection(resolution.tenantContext.tenant_id, {
    provider_id: hubspotProviderDescriptor.providerId,
    provider_account_id: "portal-1025010",
    auth_method: hubspotProviderDescriptor.authMethod,
    credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: "2026-11-12T00:00:00Z",
  });
}

/** 组合根注入示例：ProviderPort（生产实现由 ZCode MCP 客户端栈适配）+ TimePort + Store。 */
export function exampleHubSpotReadAdapter(directory: string, time: TimePort = new SystemTimePort()) {
  const provider = new InMemoryProviderPort();
  provider.registerTool({
    serverName: "hubspot",
    toolName: HUBSPOT_SEARCH_CONTACTS_TOOL,
    description: "Search contacts (contract-level stand-in; tool name UNVERIFIED)",
    annotations: { readOnlyHint: true },
    respond: () => ({
      content: [{ type: "text", text: '{"results":[]}' }],
      isError: false,
      structuredContent: { results: [] },
    }),
  });
  const store = new ConnectionStore({ directory });
  return new HubSpotReadAdapter({ provider, time, store });
}

/** connector 模板加载示例：installed 恒为 false —— 模板未被任何应用接线。 */
export function exampleLoadConnectorTemplate() {
  return loadHubSpotConnectorTemplate(
    "packages/mos-integrations/src/connector/hubspot-connector-template",
  );
}
