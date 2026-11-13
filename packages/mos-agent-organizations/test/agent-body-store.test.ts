import { afterEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractValidationError,
  InvariantViolation,
} from "@mos/contracts";
import {
  AgentBodyNotFoundError,
  AgentBodyStore,
  AgentBodyValidationError,
  agentBodyFromRegistration,
} from "../src/index.js";
import type { AgentBodyRegistration } from "../src/index.js";

/**
 * AgentBodyStore 矩阵：文件持久化（durable）、tenant 隔离（fail-closed）、
 * upsert 语义与类型化错误边界。
 */

const NOW = "2026-11-13T00:00:00Z";
const STORE_FILE = "mos-agent-bodies.json";

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-agent-bodies-test-"));
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
  overrides: Partial<AgentBodyRegistration> = {},
): AgentBodyRegistration {
  return {
    tenant_id: tenantId,
    kind: "human",
    display_name: "Ada L.",
    organization_id: null,
    role: null,
    evidenced_capability_ids: [],
    ...overrides,
  };
}

function register(
  tenantId: string,
  id: string,
  overrides: Partial<AgentBodyRegistration> = {},
) {
  return agentBodyFromRegistration(registrationFor(tenantId, overrides), {
    id,
    now: NOW,
  });
}

describe("AgentBodyStore (durable, tenant-scoped)", () => {
  test("missing file starts empty; registration save/get round-trips", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    expect(store.listByTenant("tenant-acme")).toEqual([]);

    const saved = store.save("tenant-acme", register("tenant-acme", "body-1"));
    expect(saved.id).toBe("body-1");
    const loaded = store.get("tenant-acme", "body-1");
    expect(loaded.id).toBe("body-1");
    expect(loaded.display_name).toBe("Ada L.");
    expect(loaded.status).toBe("active");
  });

  test("durability: a new store instance on the same directory reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    const first = new AgentBodyStore({ directory: dir });
    first.save("tenant-acme", register("tenant-acme", "body-1"));

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = new AgentBodyStore({ directory: dir });
    expect(second.get("tenant-acme", "body-1").id).toBe("body-1");
  });

  test("registration then cross-tenant read fails closed with InvariantViolation", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "body-1"));

    expect(() => store.get("tenant-globex", "body-1")).toThrow(InvariantViolation);
    expect(() => store.get("tenant-globex", "body-1")).toThrow(/AgentBody/);
  });

  test("cross-tenant save fails closed with InvariantViolation", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    expect(() => store.save("tenant-globex", register("tenant-acme", "body-1"))).toThrow(
      InvariantViolation,
    );
    // fail-closed：未写入任何记录。
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("unknown id fails with AgentBodyNotFoundError (typed)", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    expect(() => store.get("tenant-acme", "body-missing")).toThrow(AgentBodyNotFoundError);
  });

  test("listByTenant only shows the calling tenant's bodies", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "body-1"));
    store.save("tenant-acme", register("tenant-acme", "body-2"));
    store.save("tenant-globex", register("tenant-globex", "body-3"));

    expect(store.listByTenant("tenant-acme").map((body) => body.id)).toEqual([
      "body-1",
      "body-2",
    ]);
    expect(store.listByTenant("tenant-globex").map((body) => body.id)).toEqual(["body-3"]);
  });

  test("save is an upsert: same (tenant, id) replaces in place without duplicates", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    store.save("tenant-acme", register("tenant-acme", "body-1"));
    store.save(
      "tenant-acme",
      agentBodyFromRegistration(
        registrationFor("tenant-acme", { display_name: "Ada Lovelace", role: "copy lead" }),
        { id: "body-1", now: "2026-11-13T01:00:00Z" },
      ),
    );

    const bodies = store.listByTenant("tenant-acme");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.display_name).toBe("Ada Lovelace");
    expect(bodies[0]?.role).toBe("copy lead");
  });

  test("schema-invalid body fails closed with typed AgentBodyValidationError", () => {
    const store = new AgentBodyStore({ directory: newDir() });
    const broken = { ...register("tenant-acme", "body-1"), display_name: "" };
    expect(() => store.save("tenant-acme", broken)).toThrow(AgentBodyValidationError);
    expect(() => store.save("tenant-acme", broken)).toThrow(ContractValidationError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_FILE), "{ not json", "utf8");
    expect(() => new AgentBodyStore({ directory: brokenJson }).listByTenant("t")).toThrow(
      ContractValidationError,
    );

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_FILE),
      JSON.stringify({ version: 1, agent_bodies: "nope" }),
      "utf8",
    );
    expect(() => new AgentBodyStore({ directory: wrongShape }).listByTenant("t")).toThrow(
      ContractValidationError,
    );
  });
});
