import { describe, expect, test } from "vitest";
import { parseOrFail } from "@mos/contracts";
import {
  HUBSPOT_SEARCH_CONTACTS_TOOL,
  hubspotProviderDescriptor,
  providerDescriptorSchema,
} from "../src/index.js";

describe("hubspot provider descriptor", () => {
  test("declares the official HubSpot remote MCP endpoint and OAuth method", () => {
    const descriptor = parseOrFail(
      "ProviderDescriptor",
      providerDescriptorSchema,
      hubspotProviderDescriptor,
    );
    expect(descriptor.providerId).toBe("hubspot");
    expect(descriptor.displayName).toBe("HubSpot");
    expect(descriptor.endpoint).toEqual({ kind: "http", url: "https://mcp.hubspot.com/" });
    expect(descriptor.authMethod).toBe("oauth_authorization_code");
    expect(descriptor.officialDocs).toBe("https://developers.hubspot.com/mcp");
    expect(descriptor.version).toBe(1);
    // status 使用 AGENTS.md §7 完成词汇：live 读已规划、尚未以真实账号证明。
    expect(descriptor.status).toBe("planned-live-read");
  });

  test("tool mapping is explicitly UNVERIFIED (fail-closed, no live account in this environment)", () => {
    expect(hubspotProviderDescriptor.toolMappingVerified).toBe(false);
    for (const candidate of hubspotProviderDescriptor.candidateTools) {
      expect(candidate.verified).toBe(false);
      expect(candidate.note).toContain("NOT verified");
    }
    expect(hubspotProviderDescriptor.candidateTools[0]?.toolName).toBe(HUBSPOT_SEARCH_CONTACTS_TOOL);
  });

  test("descriptor links its provider evidence record", () => {
    expect(hubspotProviderDescriptor.evidenceRefs).toContain(
      "spec/integrations/provider-evidence/hubspot-connector-evidence.md",
    );
  });

  test("schema rejects endpoint kinds other than remote http MCP", () => {
    expect(() =>
      providerDescriptorSchema.parse({
        ...hubspotProviderDescriptor,
        endpoint: { kind: "stdio", url: "https://mcp.hubspot.com/" },
      }),
    ).toThrow();
  });

  test("schema rejects unknown auth methods and missing provider identity", () => {
    // 注：authMethod 枚举在 W2 additive 扩展了 "api_key"（Composio session MCP 的
    // 文档化授权形态）；HubSpot 描述符数据不使用它。真正未知的授权形态仍然拒绝。
    expect(() =>
      providerDescriptorSchema.parse({
        ...hubspotProviderDescriptor,
        authMethod: "handrolled_bearer_token",
      }),
    ).toThrow();
    expect(() =>
      providerDescriptorSchema.parse({
        ...hubspotProviderDescriptor,
        providerId: "",
      }),
    ).toThrow();
    expect(() =>
      providerDescriptorSchema.parse({
        ...hubspotProviderDescriptor,
        version: 0,
      }),
    ).toThrow();
  });
});
