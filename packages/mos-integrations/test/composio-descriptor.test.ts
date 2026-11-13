import { describe, expect, test } from "vitest";
import { parseOrFail } from "@mos/contracts";
import {
  composioProviderDescriptor,
  composioSessionRequestSchema,
  composioSessionResponseSchema,
  COMPOSIO_MULTI_EXECUTE_TOOL,
  COMPOSIO_SEARCH_TOOLS_TOOL,
  HACKERNEWS_SEARCH_POSTS_TOOL,
  providerDescriptorSchema,
} from "../src/index.js";

/**
 * Composio provider 描述符契约测试。
 * 与 hubspot-descriptor.test.ts 同一 schema；差异在数据：
 * toolMappingVerified=true 必须有 live 观测支撑（evidence 记录 §4/§6/§7）。
 */

describe("composioProviderDescriptor", () => {
  test("passes the shared provider descriptor schema with toolMappingVerified=true", () => {
    const parsed = parseOrFail(
      "ProviderDescriptor",
      providerDescriptorSchema,
      composioProviderDescriptor,
    );
    expect(parsed.providerId).toBe("composio");
    expect(parsed.authMethod).toBe("api_key");
    expect(parsed.toolMappingVerified).toBe(true);
    expect(parsed.status).toBe("verified");
  });

  test("endpoint declares the documented hosted session MCP URL pattern", () => {
    expect(composioProviderDescriptor.endpoint.kind).toBe("http");
    expect(composioProviderDescriptor.endpoint.url).toContain(
      "backend.composio.dev/tool_router/",
    );
    // 具体 MCP URL 逐会话签发：<session_id> 段不可被当作可直连常量。
    expect(composioProviderDescriptor.endpoint.url).toContain("<session_id>");
  });

  test("verified candidate tools carry live-observation notes and evidence refs", () => {
    expect(composioProviderDescriptor.candidateTools.length).toBeGreaterThanOrEqual(3);
    for (const tool of composioProviderDescriptor.candidateTools) {
      expect(tool.verified).toBe(true);
      expect(tool.note).toContain("evidence record");
    }
    expect(composioProviderDescriptor.evidenceRefs).toEqual([
      "spec/integrations/provider-evidence/composio-connector-evidence.md",
    ]);
  });

  test("declares exactly the observed meta-tools and the executed read tool", () => {
    const names = composioProviderDescriptor.candidateTools.map((tool) => tool.toolName);
    expect(names).toContain(COMPOSIO_SEARCH_TOOLS_TOOL);
    expect(names).toContain(COMPOSIO_MULTI_EXECUTE_TOOL);
    expect(names).toContain(HACKERNEWS_SEARCH_POSTS_TOOL);
  });

  test("official docs point at the documented session-MCP transport", () => {
    expect(composioProviderDescriptor.officialDocs).toBe(
      "https://docs.composio.dev/docs/sessions-via-mcp",
    );
  });
});

describe("composioSessionRequestSchema / ResponseSchema", () => {
  test("session request requires mcp:true and a non-empty toolkit allowlist", () => {
    expect(
      composioSessionRequestSchema.safeParse({
        user_id: "mos-live-verify",
        mcp: true,
        toolkits: { enable: ["hackernews"] },
      }).success,
    ).toBe(true);
    expect(
      composioSessionRequestSchema.safeParse({
        user_id: "mos-live-verify",
        mcp: false,
        toolkits: { enable: ["hackernews"] },
      }).success,
    ).toBe(false);
    expect(
      composioSessionRequestSchema.safeParse({
        user_id: "mos-live-verify",
        mcp: true,
        toolkits: { enable: [] },
      }).success,
    ).toBe(false);
  });

  test("session response requires session_id and the hosted mcp url", () => {
    expect(
      composioSessionResponseSchema.safeParse({
        session_id: "trs_example",
        mcp: { type: "http", url: "https://backend.composio.dev/tool_router/trs_example/mcp" },
      }).success,
    ).toBe(true);
    expect(
      composioSessionResponseSchema.safeParse({ session_id: "trs_example" }).success,
    ).toBe(false);
  });
});
