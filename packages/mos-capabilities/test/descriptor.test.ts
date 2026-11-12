import { describe, expect, test } from "vitest";
import { capabilityDescriptorSchema } from "../src/index.js";

const BASE = {
  id: "desc-hubspot-contacts-read",
  version: 1,
  domain: "crm",
  description: "Search HubSpot CRM contacts.",
  capabilityId: "crm.contacts.read",
  providerId: "hubspot",
  integrationId: "mos-hubspot-connector",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  sideEffect: "read",
  riskLevel: "low",
  requiredScopes: ["crm.objects.contacts.read"],
  requiredAccountTypes: [],
  requiredAppReview: null,
  permissionMode: "zcode_existing_permissions",
  evidenceSource: {
    documentationUrl: "https://developers.hubspot.com/mcp",
    observedAt: "2026-11-12T00:00:00Z",
  },
  knownGaps: ["tool mapping unverified"],
  supportStatus: "supported",
  fallback: null,
  toolMapping: { toolName: "hubspot_search_contacts", verified: false, verifiedAt: null },
};

describe("capability descriptor schema (strategy §3)", () => {
  test("accepts a complete descriptor", () => {
    const parsed = capabilityDescriptorSchema.parse(BASE);
    expect(parsed.capabilityId).toBe("crm.contacts.read");
    expect(parsed.permissionMode).toBe("zcode_existing_permissions");
    expect(parsed.toolMapping).toEqual({
      toolName: "hubspot_search_contacts",
      verified: false,
      verifiedAt: null,
    });
  });

  test("applies defaults for description and knownGaps", () => {
    const parsed = capabilityDescriptorSchema.parse({
      ...BASE,
      description: undefined,
      knownGaps: undefined,
    });
    expect(parsed.description).toBe("");
    expect(parsed.knownGaps).toEqual([]);
  });

  test("provider and integration package identifiers are required (strategy §3)", () => {
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, providerId: "" })).toThrow();
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, integrationId: "" })).toThrow();
    const withoutProvider = { ...BASE } as Partial<typeof BASE>;
    delete withoutProvider.providerId;
    expect(() => capabilityDescriptorSchema.parse(withoutProvider)).toThrow();
    const parsed = capabilityDescriptorSchema.parse(BASE);
    expect(parsed.providerId).toBe("hubspot");
    expect(parsed.integrationId).toBe("mos-hubspot-connector");
  });

  test("permissionMode only accepts the existing ZCode permission path (no second permission system)", () => {
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, permissionMode: "mos_grant_all" }),
    ).toThrow();
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, permissionMode: "zcode_yolo_auto" }),
    ).toThrow();
  });

  test("version must be an integer >= 1", () => {
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, version: 0 })).toThrow();
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, version: 1.5 })).toThrow();
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, version: "1" })).toThrow();
  });

  test("supportStatus must come from the capability support enum (never a guess)", () => {
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, supportStatus: "maybe" })).toThrow();
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, supportStatus: null })).toThrow();
  });

  test("evidenceSource requires a documentation url and an RFC3339 observedAt", () => {
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, evidenceSource: { documentationUrl: "", observedAt: "2026-11-12T00:00:00Z" } }),
    ).toThrow();
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, evidenceSource: { documentationUrl: "https://developers.hubspot.com/mcp", observedAt: "2026-11-12 00:00:00" } }),
    ).toThrow();
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, evidenceSource: { documentationUrl: "https://developers.hubspot.com/mcp", observedAt: "yesterday" } }),
    ).toThrow();
  });

  test("requiredAppReview and fallback must be explicit (nullable string, never omitted)", () => {
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, requiredAppReview: undefined })).toThrow();
    expect(() => capabilityDescriptorSchema.parse({ ...BASE, fallback: undefined })).toThrow();
    expect(capabilityDescriptorSchema.parse({ ...BASE, requiredAppReview: "approved" }).requiredAppReview).toBe("approved");
    expect(capabilityDescriptorSchema.parse({ ...BASE, fallback: "manual export" }).fallback).toBe("manual export");
  });

  test("toolMapping carries the verification facts (verified flag + nullable verifiedAt)", () => {
    expect(() =>
      capabilityDescriptorSchema.parse({ ...BASE, toolMapping: { toolName: "x", verifiedAt: null } }),
    ).toThrow();
    const verified = capabilityDescriptorSchema.parse({
      ...BASE,
      toolMapping: { toolName: "hubspot_search_contacts", verified: true, verifiedAt: "2026-11-12T00:00:00Z" },
    });
    expect(verified.toolMapping.verified).toBe(true);
    expect(verified.toolMapping.verifiedAt).toBe("2026-11-12T00:00:00Z");
  });
});
