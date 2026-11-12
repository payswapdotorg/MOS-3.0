import { describe, expect, test } from "vitest";
import {
  capabilitySchema,
  ContractValidationError,
  providerImplementationSchema,
  type ProviderImplementation,
} from "@mos/contracts";
import { CapabilityCatalog, type CapabilityDescriptorInput } from "../src/index.js";
import { baseDescriptor, baseImplementation, CAPABILITY_ID, IMPLEMENTATION_ID } from "./fixtures.js";

describe("CapabilityCatalog (fail-closed registration)", () => {
  test("register validates the descriptor and derives a contract-valid Capability", () => {
    const catalog = new CapabilityCatalog();
    const capability = catalog.register(baseDescriptor());
    expect(capability.id).toBe(CAPABILITY_ID);
    expect(() => capabilitySchema.parse(capability)).not.toThrow();
    expect(capability.support_status).toBe("supported");
    expect(capability.required_scopes).toEqual(["crm.objects.contacts.read"]);
    expect(capability.risk_level).toBe("low");
    expect(catalog.getCapability(CAPABILITY_ID)).toEqual(capability);
  });

  test("register rejects an invalid descriptor instead of storing it", () => {
    const catalog = new CapabilityCatalog();
    // 负向测试：类型层面就不合法的 permissionMode 只能显式断言注入（与下方
    // “hallucinating” 实现状态的注入同约定）——运行时 schema 拒绝才是被测行为。
    expect(() =>
      catalog.register(
        baseDescriptor({
          permissionMode: "mos_bypass" as unknown as CapabilityDescriptorInput["permissionMode"],
        }),
      ),
    ).toThrow(ContractValidationError);
    expect(catalog.getCapability(CAPABILITY_ID)).toBeNull();
    expect(catalog.getDescriptor(CAPABILITY_ID)).toBeNull();
  });

  test("descriptor lookup exposes the tool mapping verification facts", () => {
    const catalog = new CapabilityCatalog();
    catalog.register(baseDescriptor());
    const descriptor = catalog.getDescriptor(CAPABILITY_ID);
    expect(descriptor?.toolMapping).toEqual({
      toolName: "hubspot_search_contacts",
      verified: false,
      verifiedAt: null,
    });
    expect(catalog.getDescriptor("unknown-capability")).toBeNull();
  });

  test("re-registering a capability replaces it (latest descriptor wins)", () => {
    const catalog = new CapabilityCatalog();
    catalog.register(baseDescriptor());
    const replaced = catalog.register(
      baseDescriptor({ id: "desc-hubspot-contacts-read-v2", description: "updated" }),
    );
    expect(catalog.getCapability(CAPABILITY_ID)?.description).toBe("updated");
    expect(replaced.description).toBe("updated");
  });

  test("registerImplementation validates with the contract schema and indexes by id", () => {
    const catalog = new CapabilityCatalog();
    const implementation = catalog.registerImplementation(baseImplementation());
    expect(() => providerImplementationSchema.parse(implementation)).not.toThrow();
    expect(catalog.getImplementation(IMPLEMENTATION_ID)?.id).toBe(IMPLEMENTATION_ID);
    expect(catalog.getImplementation("unknown-impl")).toBeNull();
  });

  test("registerImplementation rejects an invalid implementation (fail-closed)", () => {
    const catalog = new CapabilityCatalog();
    const invalid = {
      ...baseImplementation(),
      status: "hallucinating" as unknown as ProviderImplementation["status"],
    };
    expect(() => catalog.registerImplementation(invalid)).toThrow(ContractValidationError);
    expect(catalog.getImplementation(IMPLEMENTATION_ID)).toBeNull();
  });

  test("implementationsForCapability filters by capability and ignores others", () => {
    const catalog = new CapabilityCatalog();
    catalog.registerImplementation(baseImplementation());
    catalog.registerImplementation(
      baseImplementation({
        id: "impl-other",
        capability_id: "crm.deals.read",
        provider_id: "hubspot",
      }),
    );
    const implementations = catalog.implementationsForCapability(CAPABILITY_ID);
    expect(implementations).toHaveLength(1);
    expect(implementations[0]?.id).toBe(IMPLEMENTATION_ID);
    expect(catalog.implementationsForCapability("crm.deals.read")).toHaveLength(1);
    expect(catalog.implementationsForCapability("no.such.capability")).toEqual([]);
  });
});
