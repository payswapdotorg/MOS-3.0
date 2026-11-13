import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractValidationError,
  InvariantViolation,
} from "@mos/contracts";
import {
  OrganizationNotFoundError,
  OrganizationStore,
  OrganizationValidationError,
  organizationFromRegistration,
} from "../src/index.js";
import type { OrganizationRegistration } from "../src/index.js";

/**
 * OrganizationStore 矩阵：tenant 隔离（fail-closed）、durable 持久化、
 * upsert 语义与类型化错误边界。
 */

const NOW = "2026-11-13T00:00:00Z";

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-organizations-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function registrationFor(
  tenantId: string,
  overrides: Partial<OrganizationRegistration> = {},
): OrganizationRegistration {
  return {
    tenant_id: tenantId,
    name: "Acme Content Guild",
    description: null,
    ...overrides,
  };
}

function register(tenantId: string, id: string, overrides: Partial<OrganizationRegistration> = {}) {
  return organizationFromRegistration(registrationFor(tenantId, overrides), {
    id,
    now: NOW,
  });
}

describe("OrganizationStore (durable, tenant-scoped)", () => {
  test("registration save/get round-trips; unknown description stays null", () => {
    const store = new OrganizationStore({ directory: newDir() });
    const saved = store.save("tenant-acme", register("tenant-acme", "org-1"));
    expect(saved.status).toBe("active");

    const loaded = store.get("tenant-acme", "org-1");
    expect(loaded.id).toBe("org-1");
    expect(loaded.name).toBe("Acme Content Guild");
    expect(loaded.description).toBeNull();
  });

  test("provided description passes through verbatim (zero inference)", () => {
    const store = new OrganizationStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "org-1", { description: "B2B content team" }));
    expect(store.get("tenant-acme", "org-1").description).toBe("B2B content team");
  });

  test("cross-tenant read fails closed with InvariantViolation (tenant scoping)", () => {
    const store = new OrganizationStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "org-1"));

    expect(() => store.get("tenant-globex", "org-1")).toThrow(InvariantViolation);
    expect(() => store.get("tenant-globex", "org-1")).toThrow(/Organization/);
  });

  test("cross-tenant save fails closed with InvariantViolation", () => {
    const store = new OrganizationStore({ directory: newDir() });
    expect(() => store.save("tenant-globex", register("tenant-acme", "org-1"))).toThrow(
      InvariantViolation,
    );
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("unknown id fails with OrganizationNotFoundError (typed)", () => {
    const store = new OrganizationStore({ directory: newDir() });
    expect(() => store.get("tenant-acme", "org-missing")).toThrow(OrganizationNotFoundError);
  });

  test("listByTenant only shows the calling tenant's organizations", () => {
    const store = new OrganizationStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "org-1"));
    store.save("tenant-globex", register("tenant-globex", "org-2"));

    expect(store.listByTenant("tenant-acme").map((org) => org.id)).toEqual(["org-1"]);
    expect(store.listByTenant("tenant-globex").map((org) => org.id)).toEqual(["org-2"]);
  });

  test("save is an upsert: same (tenant, id) replaces in place without duplicates", () => {
    const store = new OrganizationStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "org-1"));
    store.save(
      "tenant-acme",
      organizationFromRegistration(
        registrationFor("tenant-acme", { name: "Acme Growth Guild" }),
        { id: "org-1", now: "2026-11-13T01:00:00Z" },
      ),
    );

    const organizations = store.listByTenant("tenant-acme");
    expect(organizations).toHaveLength(1);
    expect(organizations[0]?.name).toBe("Acme Growth Guild");
  });

  test("schema-invalid organization fails closed with typed OrganizationValidationError", () => {
    const store = new OrganizationStore({ directory: newDir() });
    const broken = { ...register("tenant-acme", "org-1"), name: "" };
    expect(() => store.save("tenant-acme", broken)).toThrow(OrganizationValidationError);
    expect(() => store.save("tenant-acme", broken)).toThrow(ContractValidationError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });
});
