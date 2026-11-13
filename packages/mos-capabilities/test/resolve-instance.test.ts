import { describe, expect, test } from "vitest";
import {
  assertCapabilityInstanceAvailability,
  capabilityInstanceSchema,
  InvariantViolation,
} from "@mos/contracts";
import type { TimePort } from "@mos/integrations";
import {
  CapabilityCatalog,
  CapabilityInstanceResolverService,
  resolveCapabilityInstance,
} from "../src/index.js";
import {
  exampleComposioConnection,
  exampleComposioDiscussionSearchDescriptor,
  exampleResolveComposioDiscussionSearch,
} from "../src/contract.example.js";
import {
  baseConnection,
  baseDescriptor,
  baseImplementation,
  CAPABILITY_ID,
  IMPLEMENTATION_ID,
  HUBSPOT_EVIDENCE_REF,
  NOW,
} from "./fixtures.js";

/**
 * 实例解析器全分支矩阵（fail-closed 判定的唯一实现）。
 * 铁律：status 绝不 available，除非 connected + scope 覆盖 + 工具映射核实 +
 * 实现可用 + 证据齐备；任何缺口 → unavailable + 可机检 missing_preconditions。
 */

const fixedTime: TimePort = { now: () => NOW };

/** 经 catalog 投影出 core-contracts Capability（单一事实来源：描述符）。 */
function capabilityFrom(overrides: Parameters<typeof baseDescriptor>[0] = {}) {
  return new CapabilityCatalog().register(baseDescriptor(overrides));
}

function resolve(overrides: {
  tenantId?: string;
  connection?: ReturnType<typeof baseConnection>;
  capability?: ReturnType<typeof capabilityFrom>;
  implementation?: ReturnType<typeof baseImplementation>;
  toolMappingVerified?: boolean;
}) {
  return resolveCapabilityInstance({
    tenantId: overrides.tenantId ?? "tenant-acme",
    connection: overrides.connection ?? baseConnection(),
    capability: overrides.capability ?? capabilityFrom(),
    implementation: overrides.implementation ?? baseImplementation(),
    toolMappingVerified: overrides.toolMappingVerified ?? true,
    now: NOW,
  });
}

describe("resolveCapabilityInstance (pure fail-closed resolver)", () => {
  test("tenant mismatch fails closed (never resolves another tenant's connection)", () => {
    expect(() => resolve({ tenantId: "tenant-globex" })).toThrow(InvariantViolation);
  });

  test("available: connected + scopes covered + verified mapping + available implementation + evidence", () => {
    const instance = resolve({});
    expect(instance).toEqual({
      id: "ci:tenant-acme:crm.contacts.read:conn-1",
      tenant_id: "tenant-acme",
      connection_id: "conn-1",
      capability_id: CAPABILITY_ID,
      implementation_id: IMPLEMENTATION_ID,
      support_status: "supported",
      status: "available",
      available_quota: null,
      constraints: [],
      missing_preconditions: [],
      checked_at: NOW,
      evidence_refs: [HUBSPOT_EVIDENCE_REF],
    });
    expect(() => capabilityInstanceSchema.parse(instance)).not.toThrow();
    // available 结果携带实时连接检查 + scope 检查支撑，通过不变量守卫。
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: true,
      }),
    ).not.toThrow();
  });

  test("non-connected connections → unavailable + connection:<status> (support stays supported)", () => {
    for (const status of ["expired", "revoked", "error", "unknown"] as const) {
      const instance = resolve({ connection: baseConnection({ status }) });
      expect(instance.status).toBe("unavailable");
      expect(instance.support_status).toBe("supported");
      expect(instance.missing_preconditions).toContain(`connection:${status}`);
    }
  });

  test("missing scopes → unavailable + scope:<x> preconditions (support stays supported)", () => {
    const instance = resolve({ connection: baseConnection({ granted_scopes: [] }) });
    expect(instance.status).toBe("unavailable");
    expect(instance.support_status).toBe("supported");
    expect(instance.missing_preconditions).toEqual(["scope:crm.objects.contacts.read"]);
  });

  test("scope requirements are the union of capability and implementation scopes", () => {
    const instance = resolve({
      implementation: baseImplementation({ required_scopes: ["crm.objects.deals.read"] }),
    });
    // 连接只授予 contacts；deals（来自实现）逐项列为缺口。
    expect(instance.status).toBe("unavailable");
    expect(instance.missing_preconditions).toEqual(["scope:crm.objects.deals.read"]);
  });

  test("unverified tool mapping → support_status unknown + unavailable (even when the account is fine)", () => {
    const instance = resolve({ toolMappingVerified: false });
    expect(instance.status).toBe("unavailable");
    expect(instance.support_status).toBe("unknown");
    expect(instance.missing_preconditions).toEqual(["tool_mapping_unverified"]);
  });

  test("account type requirements: missing type → account_type:unknown; wrong type → account_type:<type>", () => {
    const capability = capabilityFrom({ requiredAccountTypes: ["hubspot_developer"] });
    const missing = resolve({
      capability,
      connection: baseConnection({ account_type: null }),
    });
    expect(missing.status).toBe("unavailable");
    expect(missing.missing_preconditions).toEqual(["account_type:unknown"]);

    const wrong = resolve({
      capability,
      connection: baseConnection({ account_type: "standard" }),
    });
    expect(wrong.status).toBe("unavailable");
    expect(wrong.missing_preconditions).toEqual(["account_type:standard"]);

    const matching = resolve({
      capability,
      connection: baseConnection({ account_type: "hubspot_developer" }),
    });
    expect(matching.status).toBe("available");
    expect(matching.missing_preconditions).toEqual([]);
  });

  test("implementation unavailable/unknown → implementation:<status> precondition", () => {
    for (const status of ["unavailable", "unknown"] as const) {
      const instance = resolve({ implementation: baseImplementation({ status }) });
      expect(instance.status).toBe("unavailable");
      expect(instance.missing_preconditions).toEqual([`implementation:${status}`]);
    }
  });

  test("degraded implementation (everything else satisfied) → instance degraded, support stays supported", () => {
    const instance = resolve({ implementation: baseImplementation({ status: "degraded" }) });
    expect(instance.status).toBe("degraded");
    expect(instance.support_status).toBe("supported");
    expect(instance.missing_preconditions).toEqual([]);
  });

  test("capability support_status unknown → unavailable + capability:status_unknown, support stays unknown", () => {
    const instance = resolve({ capability: capabilityFrom({ supportStatus: "unknown" }) });
    expect(instance.status).toBe("unavailable");
    expect(instance.support_status).toBe("unknown");
    expect(instance.missing_preconditions).toEqual(["capability:status_unknown"]);
  });

  test("unsupported and unknown stay distinct states (never merged)", () => {
    const unsupported = resolve({ capability: capabilityFrom({ supportStatus: "unsupported" }) });
    const unknown = resolve({ capability: capabilityFrom({ supportStatus: "unknown" }) });
    expect(unsupported.status).toBe("unavailable");
    expect(unknown.status).toBe("unavailable");
    // 不同知识状态，绝不互相归并（§invariants 3）。
    expect(unsupported.support_status).toBe("unsupported");
    expect(unknown.support_status).toBe("unknown");
    expect(unsupported.support_status).not.toBe(unknown.support_status);
    // unsupported 是 terminal 知识状态：账户条件再差也只是事实披露。
    const unsupportedExpired = resolve({
      capability: capabilityFrom({ supportStatus: "unsupported" }),
      connection: baseConnection({ status: "expired" }),
    });
    expect(unsupportedExpired.support_status).toBe("unsupported");
    expect(unsupportedExpired.status).toBe("unavailable");
    expect(unsupportedExpired.missing_preconditions).toEqual(["connection:expired"]);
  });

  test("missing implementation evidence → unavailable + evidence precondition (never available without evidence)", () => {
    const instance = resolve({ implementation: baseImplementation({ evidence_refs: [] }) });
    expect(instance.status).toBe("unavailable");
    expect(instance.support_status).toBe("supported");
    expect(instance.missing_preconditions).toEqual(["evidence:implementation_evidence_missing"]);
    expect(instance.evidence_refs).toEqual([]);
  });

  test("every available instance carries evidence_refs", () => {
    const instance = resolve({});
    expect(instance.status).toBe("available");
    expect(instance.evidence_refs.length).toBeGreaterThan(0);
  });

  test("precondition order is deterministic: connection → tool_mapping → scope → account_type → implementation → capability", () => {
    const instance = resolve({
      connection: baseConnection({ status: "expired", granted_scopes: [], account_type: null }),
      capability: capabilityFrom({
        requiredAccountTypes: ["hubspot_developer"],
        supportStatus: "unknown",
      }),
      implementation: baseImplementation({ status: "unknown" }),
      toolMappingVerified: false,
    });
    expect(instance.status).toBe("unavailable");
    expect(instance.missing_preconditions).toEqual([
      "connection:expired",
      "tool_mapping_unverified",
      "scope:crm.objects.contacts.read",
      "account_type:unknown",
      "implementation:unknown",
      "capability:status_unknown",
    ]);
  });

  test("instance id is deterministic per tenant/capability/connection (re-resolution reconciles)", () => {
    const first = resolve({});
    const second = resolve({});
    expect(second.id).toBe(first.id);
    const otherConnection = resolve({
      connection: baseConnection({ id: "conn-2" }),
    });
    expect(otherConnection.id).not.toBe(first.id);
    expect(otherConnection.id).toBe("ci:tenant-acme:crm.contacts.read:conn-2");
  });

  test("all resolver outputs validate against the core contract instance schema", () => {
    const outcomes = [
      resolve({}),
      resolve({ toolMappingVerified: false }),
      resolve({ connection: baseConnection({ status: "revoked" }) }),
      resolve({ implementation: baseImplementation({ status: "degraded" }) }),
    ];
    for (const outcome of outcomes) {
      expect(() => capabilityInstanceSchema.parse(outcome)).not.toThrow();
    }
  });
});

describe("assertCapabilityInstanceAvailability integration (invariant §1/§2)", () => {
  test("available without live-check basis throws (guard is wired, not decorative)", () => {
    const instance = capabilityInstanceSchema.parse({
      id: "ci-synthetic",
      tenant_id: "tenant-acme",
      connection_id: "conn-1",
      capability_id: CAPABILITY_ID,
      implementation_id: IMPLEMENTATION_ID,
      support_status: "supported",
      status: "available",
      checked_at: NOW,
      evidence_refs: [HUBSPOT_EVIDENCE_REF],
    });
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: false,
        requiredScopesCovered: true,
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: false,
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: true,
      }),
    ).not.toThrow();
  });

  test("resolver never emits available when the live-check basis is absent", () => {
    const deficient = [
      resolve({ connection: baseConnection({ status: "expired" }) }),
      resolve({ connection: baseConnection({ granted_scopes: [] }) }),
      resolve({ toolMappingVerified: false }),
      resolve({ implementation: baseImplementation({ evidence_refs: [] }) }),
    ];
    for (const instance of deficient) {
      expect(instance.status).not.toBe("available");
    }
  });
});

describe("CapabilityInstanceResolverService (catalog + TimePort wiring)", () => {
  function makeService(options: {
    registerDescriptor?: boolean;
    descriptorOverrides?: Parameters<typeof baseDescriptor>[0];
    implementationOverrides?: Parameters<typeof baseImplementation>[0];
  } = {}) {
    const catalog = new CapabilityCatalog();
    if (options.registerDescriptor !== false) {
      catalog.register(baseDescriptor(options.descriptorOverrides));
    }
    catalog.registerImplementation(baseImplementation(options.implementationOverrides));
    return new CapabilityInstanceResolverService({ catalog, time: fixedTime });
  }

  test("resolves available when the descriptor's tool mapping is verified (checked_at from TimePort)", () => {
    const service = makeService({
      descriptorOverrides: {
        toolMapping: { toolName: "hubspot_search_contacts", verified: true, verifiedAt: NOW },
      },
    });
    const instance = service.resolveForConnection({
      tenantId: "tenant-acme",
      connection: baseConnection(),
      capabilityId: CAPABILITY_ID,
      implementationId: IMPLEMENTATION_ID,
    });
    expect(instance.status).toBe("available");
    expect(instance.support_status).toBe("supported");
    expect(instance.missing_preconditions).toEqual([]);
    expect(instance.checked_at).toBe(NOW);
  });

  test("unverified descriptor tool mapping → unknown/unavailable through the service", () => {
    const service = makeService(); // fixture 默认 toolMapping.verified=false
    const instance = service.resolveForConnection({
      tenantId: "tenant-acme",
      connection: baseConnection(),
      capabilityId: CAPABILITY_ID,
      implementationId: IMPLEMENTATION_ID,
    });
    expect(instance.status).toBe("unavailable");
    expect(instance.support_status).toBe("unknown");
    expect(instance.missing_preconditions).toEqual(["tool_mapping_unverified"]);
  });

  test("capability not registered → CapabilityNotFoundError (fail-closed, no fabricated capability)", () => {
    const service = makeService({ registerDescriptor: false });
    expect(() =>
      service.resolveForConnection({
        tenantId: "tenant-acme",
        connection: baseConnection(),
        capabilityId: CAPABILITY_ID,
        implementationId: IMPLEMENTATION_ID,
      }),
    ).toThrow(/capability not registered/);
  });

  test("implementation not registered → ImplementationNotFoundError", () => {
    const catalog = new CapabilityCatalog();
    catalog.register(baseDescriptor());
    const service = new CapabilityInstanceResolverService({ catalog, time: fixedTime });
    expect(() =>
      service.resolveForConnection({
        tenantId: "tenant-acme",
        connection: baseConnection(),
        capabilityId: CAPABILITY_ID,
        implementationId: "impl-not-registered",
      }),
    ).toThrow(/implementation not registered/);
  });

  test("cross-tenant connection → ConnectionTenantMismatchError (typed, before any lookup)", () => {
    // 空 catalog：若不先拦截 tenant，会先抛 CapabilityNotFoundError——被测行为是拦截优先。
    const catalog = new CapabilityCatalog();
    const service = new CapabilityInstanceResolverService({ catalog, time: fixedTime });
    expect(() =>
      service.resolveForConnection({
        tenantId: "tenant-globex",
        connection: baseConnection(),
        capabilityId: CAPABILITY_ID,
        implementationId: IMPLEMENTATION_ID,
      }),
    ).toThrow(/connection belongs to tenant tenant-acme, requested by tenant-globex/);
  });

  test("implementation paired with another capability → InvariantViolation (pairing invariant)", () => {
    const service = makeService({
      implementationOverrides: { capability_id: "crm.deals.read" },
    });
    expect(() =>
      service.resolveForConnection({
        tenantId: "tenant-acme",
        connection: baseConnection(),
        capabilityId: CAPABILITY_ID,
        implementationId: IMPLEMENTATION_ID,
      }),
    ).toThrow(InvariantViolation);
  });

  test("tenant mismatch is also guarded inside the pure resolver (defense in depth)", () => {
    expect(() =>
      resolveCapabilityInstance({
        tenantId: "tenant-globex",
        connection: baseConnection(),
        capability: capabilityFrom(),
        implementation: baseImplementation(),
        toolMappingVerified: true,
        now: NOW,
      }),
    ).toThrow(InvariantViolation);
  });
});

/**
 * Composio 样例（W2，contract.example.ts）：第一条 toolMappingVerified=true 的能力。
 * 与真实 Composio 账号（auth_method=api_key，无 scope 要求）+ live 证据支撑的实现
 * 一起解析 → available（与 HubSpot 样例的 unknown/unavailable 现状相对）。
 */
describe("exampleResolveComposioDiscussionSearch (verified mapping + real evidence)", () => {
  test("resolves available for a connected Composio api-key connection", () => {
    const instance = exampleResolveComposioDiscussionSearch();
    expect(instance.status).toBe("available");
    expect(instance.support_status).toBe("supported");
    expect(instance.missing_preconditions).toEqual([]);
    expect(instance.evidence_refs).toEqual([
      "spec/integrations/provider-evidence/composio-connector-evidence.md",
    ]);
    expect(() =>
      assertCapabilityInstanceAvailability(instance, {
        liveConnectionChecked: true,
        requiredScopesCovered: true,
      }),
    ).not.toThrow();
    expect(() => capabilityInstanceSchema.parse(instance)).not.toThrow();
  });

  test("the same path stays fail-closed without a connected Composio connection", () => {
    const degraded = resolveCapabilityInstance({
      tenantId: "tenant-acme",
      connection: { ...exampleComposioConnection(), status: "error" },
      capability: new CapabilityCatalog().register(
        exampleComposioDiscussionSearchDescriptor(),
      ),
      implementation: new CapabilityCatalog().registerImplementation({
        id: "impl-composio-discussion-search",
        provider_id: "composio",
        capability_id: "research.discussion.search",
        version: 1,
        operation_mapping: [
          {
            tool_name: "COMPOSIO_MULTI_EXECUTE_TOOL",
            arguments: { tools: [{ tool_slug: "HACKERNEWS_SEARCH_POSTS", arguments: {} }] },
          },
        ],
        status: "available",
        evidence_refs: ["spec/integrations/provider-evidence/composio-connector-evidence.md"],
      }),
      toolMappingVerified: true,
      now: NOW,
    });
    expect(degraded.status).toBe("unavailable");
    expect(degraded.missing_preconditions.join(" ")).toContain("connection:");
  });
});
