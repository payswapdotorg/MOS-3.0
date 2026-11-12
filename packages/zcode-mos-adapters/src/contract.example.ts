/**
 * contract.example.ts —— 端口契约的使用样例。
 * 展示组合根应如何注入 ProviderPort / SessionFactsPort，以及错误分类的调用方式。
 */
import {
  InMemoryProviderPort,
  InMemorySessionFactsPort,
  SystemTimePort,
  classifyProviderError,
  missingScopes,
  toProviderToolName,
} from "./index.js";

/** 组合根注入示例：生产实现由 ZCode MCP 客户端栈适配而来（见集成测试）。 */
export function exampleProviderPortAdaptation() {
  const provider = new InMemoryProviderPort();
  provider.registerTool({
    serverName: "hubspot",
    toolName: "search_contacts",
    description: "Read contacts (contract-level stand-in)",
    annotations: { readOnlyHint: true },
    respond: () => ({
      content: [{ type: "text", text: '{"records": []}' }],
      isError: false,
      structuredContent: null,
    }),
  });
  return provider;
}

/** 会话事实注入示例：sidecar 只在任务创建成功后关联。 */
export function exampleSessionFactsPort() {
  return new InMemorySessionFactsPort({
    session: {
      sessionId: "sess_demo",
      taskId: "sess_demo",
      workspace: { workspacePath: "/work/acme", workspaceIdentity: null, workspaceKey: "/work/acme", projectId: "proj_work_acme" },
    },
    user: { userId: "user-1", organizationId: null, loginProvider: "zai" },
  });
}

/** 负向矩阵示例：过期令牌 → unauthorized → invalidate_instance。 */
export function exampleExpiredTokenClassification() {
  const classified = classifyProviderError({
    message: "HTTP 401: token expired or revoked; re-auth required",
  });
  return classified; // { kind: "unauthorized", retryable: false, ... }
}

/** scope 覆盖检查示例。 */
export function exampleScopeCoverage() {
  const missing = missingScopes(
    ["crm.objects.contacts.read", "crm.objects.deals.read"],
    ["crm.objects.contacts.read"],
  );
  return missing; // ["crm.objects.deals.read"]
}

/** 工具名合成示例：与 ZCode `mcp__server__tool` 规则一致。 */
export function exampleCanonicalToolName() {
  return toProviderToolName("hubspot", "search_contacts");
}

export { SystemTimePort };
