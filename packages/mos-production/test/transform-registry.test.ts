import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  TransformNotFoundError,
  TransformRegistry,
  TransformValidationError,
} from "../src/index.js";
import type { TimePort, TransformDefinitionInput } from "../src/index.js";

/**
 * TransformRegistry 矩阵：注册 + tenant 隔离 + 跨租户 fail-closed、
 * 逐字 intake、版本 bump、持久化与损坏文件 fail-closed。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const TENANT = "tenant-acme";
const OTHER_TENANT = "tenant-globex";
const STORE_FILE = "mos-transforms.json";

class MutableClock implements TimePort {
  private current: string;
  constructor(initial: string) {
    this.current = initial;
  }
  now(): string {
    return this.current;
  }
  advance(next: string): void {
    this.current = next;
  }
}

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-transforms-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newRegistry(dir: string, time?: TimePort): TransformRegistry {
  return new TransformRegistry({ directory: dir, time });
}

function definitionInput(
  overrides: Partial<TransformDefinitionInput> = {},
): TransformDefinitionInput {
  return {
    name: "caption",
    description: null,
    parameters_schema: { type: "object", properties: { language: { type: "string" } } },
    required_capability_id: "media.caption",
    side_effect: "none",
    risk_level: "low",
    status: "active",
    ...overrides,
  };
}

describe("TransformRegistry.register (registration + tenant scoping)", () => {
  test("missing file starts empty; first register creates version 1 active transform", () => {
    const registry = newRegistry(newDir(), new MutableClock(T1));
    expect(registry.listByTenant(TENANT)).toEqual([]);

    const transform = registry.register(TENANT, "tr-caption", definitionInput());
    expect(transform.id).toBe("tr-caption");
    expect(transform.tenant_id).toBe(TENANT);
    expect(transform.version).toBe(1);
    expect(transform.status).toBe("active");
    expect(transform.side_effect).toBe("none");
    expect(transform.risk_level).toBe("low");
    expect(transform.required_capability_id).toBe("media.caption");
    expect(transform.created_at).toBe(T1);
    expect(transform.updated_at).toBe(T1);
  });

  test("verbatim intake: absent optional fields stay null, parameters_schema copied verbatim", () => {
    const registry = newRegistry(newDir());
    const transform = registry.register(TENANT, "tr-min", {
      name: "minimal",
      description: null,
      parameters_schema: {},
      required_capability_id: null,
      side_effect: "none",
      risk_level: "unknown",
      status: "draft",
    });
    expect(transform.description).toBeNull();
    expect(transform.required_capability_id).toBeNull();
    expect(transform.parameters_schema).toEqual({});
  });

  test("invalid input (empty name / bad status / bad risk level) -> TransformValidationError, nothing persisted", () => {
    const registry = newRegistry(newDir());
    expect(() =>
      registry.register(TENANT, "tr-1", definitionInput({ name: "" })),
    ).toThrow(TransformValidationError);
    expect(() =>
      registry.register(
        TENANT,
        "tr-2",
        { ...definitionInput(), status: "live" } as unknown as TransformDefinitionInput,
      ),
    ).toThrow(TransformValidationError);
    expect(() =>
      registry.register(
        TENANT,
        "tr-3",
        { ...definitionInput(), risk_level: "extreme" } as unknown as TransformDefinitionInput,
      ),
    ).toThrow(TransformValidationError);
    expect(registry.listByTenant(TENANT)).toEqual([]);
  });

  test("cross-tenant upsert of the same transform id fails closed (InvariantViolation)", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "tr-caption", definitionInput());
    expect(() =>
      registry.register(OTHER_TENANT, "tr-caption", definitionInput({ name: "Other" })),
    ).toThrow(InvariantViolation);
    expect(registry.get(TENANT, "tr-caption").tenant_id).toBe(TENANT);
    expect(registry.listByTenant(OTHER_TENANT)).toEqual([]);
  });

  test("get: unknown id -> TransformNotFoundError; other tenant's record -> InvariantViolation", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "tr-caption", definitionInput());
    expect(() => registry.get(TENANT, "tr-missing")).toThrow(TransformNotFoundError);
    expect(() => registry.get(OTHER_TENANT, "tr-caption")).toThrow(InvariantViolation);
  });

  test("listByTenant only exposes the caller tenant's records", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "tr-1", definitionInput());
    registry.register(OTHER_TENANT, "tr-2", definitionInput({ name: "Other" }));
    expect(registry.listByTenant(TENANT).map((item) => item.id)).toEqual(["tr-1"]);
    expect(registry.listByTenant(OTHER_TENANT).map((item) => item.id)).toEqual(["tr-2"]);
  });
});

describe("TransformRegistry.register (version bump on change)", () => {
  test("re-register with changed name bumps version, keeps created_at, advances updated_at", () => {
    const clock = new MutableClock(T1);
    const registry = newRegistry(newDir(), clock);
    const first = registry.register(TENANT, "tr-caption", definitionInput());

    clock.advance(T2);
    const second = registry.register(TENANT, "tr-caption", definitionInput({
      name: "caption v2",
    }));
    expect(second.version).toBe(first.version + 1);
    expect(second.created_at).toBe(T1);
    expect(second.updated_at).toBe(T2);
    expect(registry.get(TENANT, "tr-caption").version).toBe(2);
  });

  test("re-register with identical content is idempotent: no bump, no timestamp change, no rewrite", () => {
    const clock = new MutableClock(T1);
    const dir = newDir();
    const registry = newRegistry(dir, clock);
    const first = registry.register(TENANT, "tr-caption", definitionInput());
    const fileContent = readFileSync(join(dir, STORE_FILE), "utf8");

    clock.advance(T3);
    const again = registry.register(TENANT, "tr-caption", definitionInput());
    expect(again).toEqual(first);
    expect(again.version).toBe(1);
    expect(again.updated_at).toBe(T1);
    expect(readFileSync(join(dir, STORE_FILE), "utf8")).toBe(fileContent);
  });

  test("status lifecycle (draft -> active -> retired) bumps version each change", () => {
    const clock = new MutableClock(T1);
    const registry = newRegistry(newDir(), clock);
    const v1 = registry.register(TENANT, "tr-caption", definitionInput({ status: "draft" }));
    clock.advance(T2);
    const v2 = registry.register(TENANT, "tr-caption", definitionInput({ status: "active" }));
    clock.advance(T3);
    const v3 = registry.register(TENANT, "tr-caption", definitionInput({ status: "retired" }));
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    expect(v3.status).toBe("retired");
  });
});

describe("TransformRegistry (durability + corruption fail-closed)", () => {
  test("durability: a new registry instance on the same directory reloads records; no tmp residue", () => {
    const dir = newDir();
    const first = newRegistry(dir, new MutableClock(T1));
    first.register(TENANT, "tr-caption", definitionInput());
    first.register(TENANT, "tr-clip", definitionInput({
      name: "clip",
      side_effect: "none",
      description: "Cut a segment",
    }));

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = newRegistry(dir, new MutableClock(T2));
    const reloaded = second.get(TENANT, "tr-clip");
    expect(reloaded.description).toBe("Cut a segment");
    expect(reloaded.parameters_schema).toEqual(definitionInput().parameters_schema);
  });

  test("corrupted store file (invalid JSON) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(join(dir, STORE_FILE), "{ not json", "utf8");
    expect(() => newRegistry(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("corrupted store file (wrong structure) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(join(dir, STORE_FILE), JSON.stringify({ version: 1 }), "utf8");
    expect(() => newRegistry(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("corrupted record (bad side_effect enum in file) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({
        version: 1,
        transforms: [
          {
            id: "tr-1",
            tenant_id: TENANT,
            version: 1,
            name: "Broken",
            description: null,
            parameters_schema: {},
            required_capability_id: null,
            side_effect: "explode",
            risk_level: "low",
            status: "active",
            created_at: T1,
            updated_at: T1,
          },
        ],
      }),
      "utf8",
    );
    expect(() => newRegistry(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });
});
