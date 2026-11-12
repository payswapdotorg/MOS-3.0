import { describe, expect, test } from "vitest";
import {
  InMemoryProviderPort,
  InMemorySessionFactsPort,
  SystemTimePort,
  classifyProviderError,
  findDescriptorForToolName,
  missingScopes,
  parseProviderToolName,
  providerErrorAction,
  redactProviderMessage,
  toProviderToolName,
  workspaceFactsFromPath,
} from "../src/index.js";

describe("tool name synthesis", () => {
  test("canonical name follows mcp__server__tool", () => {
    expect(toProviderToolName("hubspot", "search_contacts")).toBe("mcp__hubspot__search_contacts");
    expect(toProviderToolName("plugin:hubspot:crm", "tool")).toBe(
      "mcp__plugin_hubspot_crm__tool",
    );
  });

  test("parse is the inverse of synthesis", () => {
    const parsed = parseProviderToolName("mcp__hubspot__search_contacts");
    expect(parsed).toEqual({ serverName: "hubspot", toolName: "search_contacts" });
    expect(parseProviderToolName("hubspot__search_contacts")).toBeNull();
    expect(parseProviderToolName("mcp__hubspot__")).toBeNull();
  });

  test("descriptor matching is exact, never fuzzy", () => {
    const descriptors = [{ serverName: "hubspot", toolName: "search_contacts" }];
    expect(findDescriptorForToolName(descriptors, "mcp__hubspot__search_contacts")).toEqual({
      serverName: "hubspot",
      toolName: "search_contacts",
    });
    expect(findDescriptorForToolName(descriptors, "search_contact")).toBeNull();
    expect(findDescriptorForToolName(descriptors, "search_contacts")).toEqual({
      serverName: "hubspot",
      toolName: "search_contacts",
    });
  });
});

describe("provider error classification (negative matrix)", () => {
  test("expired/revoked token maps to unauthorized and invalidates the instance", () => {
    const classified = classifyProviderError({ message: "HTTP 401: token expired or revoked" });
    expect(classified.kind).toBe("unauthorized");
    expect(classified.retryable).toBe(false);
    expect(providerErrorAction(classified.kind)).toBe("invalidate_instance");
  });

  test("insufficient scope maps to insufficient_scope and invalidates the instance", () => {
    const classified = classifyProviderError({ message: "403 insufficient permissions for crm.objects.contacts.read" });
    expect(classified.kind).toBe("insufficient_scope");
    expect(providerErrorAction(classified.kind)).toBe("invalidate_instance");
  });

  test("wrong account/portal maps to wrong_account", () => {
    const classified = classifyProviderError({ message: "portal not found for this account" });
    expect(classified.kind).toBe("wrong_account");
    expect(providerErrorAction(classified.kind)).toBe("invalidate_instance");
  });

  test("rate limit maps to rate_limited with backoff", () => {
    const classified = classifyProviderError({ message: "HTTP 429 rate limit exceeded" });
    expect(classified.kind).toBe("rate_limited");
    expect(classified.retryable).toBe(true);
    expect(providerErrorAction(classified.kind)).toBe("backoff_and_surface");
  });

  test("provider outage maps to provider_outage and is retryable", () => {
    const classified = classifyProviderError({ message: "503 service unavailable" });
    expect(classified.kind).toBe("provider_outage");
    expect(classified.retryable).toBe(true);
  });

  test("unknown failures stay unknown and fail closed", () => {
    const classified = classifyProviderError({ message: "something odd happened" });
    expect(classified.kind).toBe("unknown");
    expect(classified.retryable).toBe(false);
    expect(providerErrorAction(classified.kind)).toBe("fail_closed");
  });

  test("numeric-only failures classify via httpStatus", () => {
    const classified = classifyProviderError({ message: "", httpStatus: 429 });
    expect(classified.kind).toBe("rate_limited");
    expect(classified.httpStatusHint).toBe(429);
  });

  test("messages are redacted and truncated", () => {
    const classified = classifyProviderError({
      message: `Bearer eyJhbGciOiJIUzI1NiJ9.e30.${"x".repeat(300)}`,
    });
    expect(classified.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(classified.message).toContain("[redacted]");
    expect(redactProviderMessage(`Bearer eyJabc123456 token`)).toContain("[redacted]");
  });
});

describe("scope coverage", () => {
  test("missing scopes are exact set differences", () => {
    const missing = missingScopes(["a", "b"], ["a"]);
    expect(missing).toEqual(["b"]);
    expect(missingScopes(["a"], ["a", "b"])).toEqual([]);
  });

  test("no wildcard or prefix inference", () => {
    expect(missingScopes(["crm.objects.read"], ["crm.objects"])).toEqual(["crm.objects.read"]);
    expect(missingScopes(["crm.objects.read"], ["crm.*"])).toEqual(["crm.objects.read"]);
  });
});

describe("in-memory ports (contract-only doubles)", () => {
  test("provider port records calls and honors scripted failures", async () => {
    const provider = new InMemoryProviderPort();
    provider.registerTool({
      serverName: "hubspot",
      toolName: "search_contacts",
      annotations: { readOnlyHint: true },
      respond: (request) => ({
        content: [{ type: "text", text: `called ${request.toolName}` }],
        isError: false,
        structuredContent: null,
      }),
    });
    await provider.connectServer("hubspot", { kind: "stdio", command: "node" });
    const tools = await provider.listTools();
    expect(tools[0]?.canonicalName).toBe("mcp__hubspot__search_contacts");
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);

    const ok = await provider.callTool({ serverName: "hubspot", toolName: "search_contacts" });
    expect(ok.isError).toBe(false);

    provider.failNextToolCall("search_contacts", "HTTP 401: token expired");
    const failed = await provider.callTool({ serverName: "hubspot", toolName: "search_contacts" });
    expect(failed.isError).toBe(true);

    const calls = provider.recordedCalls();
    expect(calls.length).toBe(2);
    expect(calls[1]?.failure).toContain("401");
  });

  test("session facts port observes task-created only after subscription", () => {
    const port = new InMemorySessionFactsPort({
      session: {
        sessionId: "sess_1",
        taskId: "sess_1",
        workspace: workspaceFactsFromPath("/work/acme", null),
      },
    });
    const seen: string[] = [];
    const dispose = port.observeTaskCreated?.((event) => seen.push(event.taskId));
    port.emitTaskCreated({
      sessionId: "sess_1",
      taskId: "sess_1",
      workspace: workspaceFactsFromPath("/work/acme", null),
      occurredAt: new SystemTimePort().now(),
    });
    expect(seen).toEqual(["sess_1"]);
    dispose?.();
    port.emitTaskCreated({
      sessionId: "sess_2",
      taskId: "sess_2",
      workspace: workspaceFactsFromPath("/work/acme", null),
      occurredAt: new SystemTimePort().now(),
    });
    expect(seen).toEqual(["sess_1"]);
  });

  test("workspace key matches ZCode identity-or-path rule", () => {
    expect(workspaceFactsFromPath("/work/acme", null).workspaceKey).toBe("/work/acme");
    expect(workspaceFactsFromPath("/work/acme", "  remote:ssh:host:path ").workspaceKey).toBe(
      "remote:ssh:host:path",
    );
  });
});
