import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  EngineNotFoundError,
  EngineRegistry,
  EngineValidationError,
} from "../src/index.js";
import type { EngineRegistrationInput, TimeSource } from "../src/index.js";

/**
 * EngineRegistry 矩阵：注册 + tenant 隔离 + 跨租户 fail-closed、
 * sandbox 策略写边界、版本 bump、持久化与损坏文件 fail-closed。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const TENANT = "tenant-acme";
const OTHER_TENANT = "tenant-globex";
const STORE_FILE = "mos-engines.json";

/** 可变时钟：验证 register 推进 updated_at / 保留 created_at。 */
class MutableClock implements TimeSource {
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
  const dir = mkdtempSync(join(tmpdir(), "mos-engines-registry-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newRegistry(dir: string, time?: TimeSource): EngineRegistry {
  return new EngineRegistry({ directory: dir, time });
}

/** 合法注册输入（沙箱策略为最小合法描述符）。 */
function registrationInput(
  overrides: Partial<EngineRegistrationInput> = {},
): EngineRegistrationInput {
  return {
    display_name: "Local media engine",
    capability_ids: ["media.caption", "media.clip"],
    provider_id: null,
    sandbox_policy: { network_egress: false, filesystem_scope: "workspace", timeout_ms: null },
    benchmark_refs: [],
    license_terms: null,
    cost_model: null,
    status: "registered",
    ...overrides,
  };
}

describe("EngineRegistry.register (registration + tenant scoping)", () => {
  test("missing file starts empty; first register creates version 1 with normalized policy", () => {
    const registry = newRegistry(newDir(), new MutableClock(T1));
    expect(registry.listByTenant(TENANT)).toEqual([]);

    const engine = registry.register(TENANT, "engine-1", registrationInput());
    expect(engine.id).toBe("engine-1");
    expect(engine.tenant_id).toBe(TENANT);
    expect(engine.version).toBe(1);
    expect(engine.status).toBe("registered");
    expect(engine.created_at).toBe(T1);
    expect(engine.updated_at).toBe(T1);
    // 沙箱策略以规范化描述符落库（未知键剥离）。
    expect(engine.sandbox_policy).toEqual({
      network_egress: false,
      filesystem_scope: "workspace",
      timeout_ms: null,
    });
  });

  test("sandbox policy is fail-closed at the write boundary (unknown scope -> EngineValidationError)", () => {
    const registry = newRegistry(newDir());
    expect(() =>
      registry.register(TENANT, "engine-1", registrationInput({
        sandbox_policy: { network_egress: false, filesystem_scope: "root", timeout_ms: null },
      })),
    ).toThrow(EngineValidationError);
    expect(registry.listByTenant(TENANT)).toEqual([]);
  });

  test("missing sandbox policy keys reject (fail-closed, nothing persisted)", () => {
    const registry = newRegistry(newDir());
    expect(() =>
      registry.register(TENANT, "engine-1", registrationInput({
        sandbox_policy: { network_egress: false },
      })),
    ).toThrow(EngineValidationError);
    expect(() =>
      registry.register(TENANT, "engine-2", registrationInput({ sandbox_policy: {} })),
    ).toThrow(EngineValidationError);
    expect(registry.listByTenant(TENANT)).toEqual([]);
  });

  test("invalid registration input (empty display_name / bad status) -> EngineValidationError", () => {
    const registry = newRegistry(newDir());
    expect(() =>
      registry.register(TENANT, "engine-1", registrationInput({ display_name: "" })),
    ).toThrow(EngineValidationError);
    // 非法 status 枚举值：运行时 schema fail-closed（类型层用 raw 对象绕过枚举窄化）。
    expect(() =>
      registry.register(
        TENANT,
        "engine-2",
        { ...registrationInput(), status: "available" } as unknown as EngineRegistrationInput,
      ),
    ).toThrow(EngineValidationError);
    expect(registry.listByTenant(TENANT)).toEqual([]);
  });

  test("cross-tenant upsert of the same engine id fails closed (InvariantViolation)", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "engine-1", registrationInput());
    expect(() =>
      registry.register(OTHER_TENANT, "engine-1", registrationInput({ display_name: "Other" })),
    ).toThrow(InvariantViolation);
    // 原租户记录未被改写。
    expect(registry.get(TENANT, "engine-1").tenant_id).toBe(TENANT);
    expect(registry.listByTenant(OTHER_TENANT)).toEqual([]);
  });

  test("get: unknown id -> EngineNotFoundError; other tenant's record -> InvariantViolation", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "engine-1", registrationInput());
    expect(() => registry.get(TENANT, "engine-missing")).toThrow(EngineNotFoundError);
    expect(() => registry.get(OTHER_TENANT, "engine-1")).toThrow(InvariantViolation);
  });

  test("listByTenant only exposes the caller tenant's records", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "engine-1", registrationInput());
    registry.register(OTHER_TENANT, "engine-2", registrationInput({ display_name: "Other" }));
    const own = registry.listByTenant(TENANT);
    expect(own.map((engine) => engine.id)).toEqual(["engine-1"]);
    expect(registry.listByTenant(OTHER_TENANT).map((engine) => engine.id)).toEqual(["engine-2"]);
  });
});

describe("EngineRegistry.register (version bump on change)", () => {
  test("re-register with changed display_name bumps version, keeps created_at, advances updated_at", () => {
    const clock = new MutableClock(T1);
    const registry = newRegistry(newDir(), clock);
    const first = registry.register(TENANT, "engine-1", registrationInput());

    clock.advance(T2);
    const second = registry.register(TENANT, "engine-1", registrationInput({
      display_name: "Local media engine v2",
    }));
    expect(second.version).toBe(first.version + 1);
    expect(second.created_at).toBe(T1);
    expect(second.updated_at).toBe(T2);
    expect(registry.get(TENANT, "engine-1").version).toBe(2);
  });

  test("re-register with changed sandbox policy bumps version", () => {
    const clock = new MutableClock(T1);
    const registry = newRegistry(newDir(), clock);
    const first = registry.register(TENANT, "engine-1", registrationInput());
    clock.advance(T2);
    const second = registry.register(TENANT, "engine-1", registrationInput({
      sandbox_policy: { network_egress: true, filesystem_scope: "none", timeout_ms: 5000 },
    }));
    expect(second.version).toBe(first.version + 1);
    expect(second.sandbox_policy).toEqual({
      network_egress: true,
      filesystem_scope: "none",
      timeout_ms: 5000,
    });
  });

  test("re-register with identical content is idempotent: no version bump, no timestamp change, no rewrite", () => {
    const clock = new MutableClock(T1);
    const dir = newDir();
    const registry = newRegistry(dir, clock);
    const first = registry.register(TENANT, "engine-1", registrationInput());
    const fileContent = readStore(dir);

    clock.advance(T3);
    const again = registry.register(TENANT, "engine-1", registrationInput());
    expect(again).toEqual(first);
    expect(again.version).toBe(1);
    expect(again.updated_at).toBe(T1);
    // 幂等路径不重写文件。
    expect(readStore(dir)).toBe(fileContent);
  });

  test("engine status lifecycle (registered -> benchmarked -> deprecated) bumps version each change", () => {
    const clock = new MutableClock(T1);
    const registry = newRegistry(newDir(), clock);
    const v1 = registry.register(TENANT, "engine-1", registrationInput());
    clock.advance(T2);
    const v2 = registry.register(TENANT, "engine-1", registrationInput({ status: "benchmarked" }));
    clock.advance(T3);
    const v3 = registry.register(TENANT, "engine-1", registrationInput({ status: "deprecated" }));
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    expect(v3.status).toBe("deprecated");
  });
});

describe("EngineRegistry (durability + corruption fail-closed)", () => {
  test("durability: a new registry instance on the same directory reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    const first = newRegistry(dir, new MutableClock(T1));
    first.register(TENANT, "engine-1", registrationInput());
    first.register(TENANT, "engine-2", registrationInput({
      display_name: "Remote engine",
      capability_ids: ["media.dub"],
      provider_id: "provider-1",
      cost_model: { amount: "0.05", currency: "USD" },
    }));

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = newRegistry(dir, new MutableClock(T2));
    const reloaded = second.get(TENANT, "engine-2");
    expect(reloaded.display_name).toBe("Remote engine");
    expect(reloaded.cost_model).toEqual({ amount: "0.05", currency: "USD" });
    expect(reloaded.sandbox_policy).toEqual({
      network_egress: false,
      filesystem_scope: "workspace",
      timeout_ms: null,
    });
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

  test("corrupted record (bad engine status in file) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({
        version: 1,
        engines: [
          {
            id: "engine-1",
            tenant_id: TENANT,
            version: 1,
            display_name: "Broken",
            capability_ids: [],
            provider_id: null,
            sandbox_policy: { network_egress: false, filesystem_scope: "workspace", timeout_ms: null },
            benchmark_refs: [],
            license_terms: null,
            cost_model: null,
            status: "available",
            created_at: T1,
            updated_at: T1,
          },
        ],
      }),
      "utf8",
    );
    expect(() => newRegistry(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("corrupted record (invalid sandbox policy in file) fails closed, never surfaces as usable", () => {
    const dir = newDir();
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({
        version: 1,
        engines: [
          {
            id: "engine-1",
            tenant_id: TENANT,
            version: 1,
            display_name: "Broken policy",
            capability_ids: ["media.caption"],
            provider_id: null,
            sandbox_policy: { network_egress: false, filesystem_scope: "everywhere", timeout_ms: null },
            benchmark_refs: [],
            license_terms: null,
            cost_model: null,
            status: "registered",
            created_at: T1,
            updated_at: T1,
          },
        ],
      }),
      "utf8",
    );
    expect(() => newRegistry(dir).listForCapability(TENANT, "media.caption")).toThrow(
      ContractValidationError,
    );
  });
});

describe("EngineRegistry.listForCapability (tenant-scoped matching)", () => {
  test("returns registered and benchmarked engines as matched; deprecated surfaced with reason", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "engine-reg", registrationInput({ status: "registered" }));
    registry.register(TENANT, "engine-bench", registrationInput({
      display_name: "Benchmarked engine",
      status: "benchmarked",
    }));
    registry.register(TENANT, "engine-deprecated", registrationInput({
      display_name: "Deprecated engine",
      status: "deprecated",
    }));
    registry.register(TENANT, "engine-unknown", registrationInput({
      display_name: "Unknown engine",
      status: "unknown",
    }));

    const result = registry.listForCapability(TENANT, "media.caption");
    expect(result.matched.map((engine) => engine.id)).toEqual(["engine-reg", "engine-bench"]);
    expect(result.noEngineRegistered).toBe(false);
    const deprecated = result.excluded.find((item) => item.engine.id === "engine-deprecated");
    expect(deprecated?.reason).toBe("deprecated");
    expect(result.excluded.find((item) => item.engine.id === "engine-unknown")?.reason).toBe(
      "unknown_status",
    );
  });

  test("unknown capability: empty matches with noEngineRegistered=true, not an error", () => {
    const registry = newRegistry(newDir());
    registry.register(TENANT, "engine-1", registrationInput());
    const result = registry.listForCapability(TENANT, "media.nonexistent");
    expect(result.matched).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.noEngineRegistered).toBe(true);
  });

  test("other tenant's engines are invisible to matching", () => {
    const registry = newRegistry(newDir());
    registry.register(OTHER_TENANT, "engine-1", registrationInput());
    const result = registry.listForCapability(TENANT, "media.caption");
    expect(result.matched).toEqual([]);
    expect(result.noEngineRegistered).toBe(true);
  });
});

/** 幂等路径断言用：直接读存储文件文本。 */
function readStore(dir: string): string {
  return readFileSync(join(dir, STORE_FILE), "utf8");
}
