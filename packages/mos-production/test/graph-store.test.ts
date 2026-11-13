import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  GraphNotFoundError,
  GraphStore,
  GraphValidationError,
} from "../src/index.js";
import type {
  EngineLookup,
  GraphInput,
  TimePort,
  TransformLookup,
} from "../src/index.js";

/**
 * GraphStore 矩阵：saveDraft/validate 门禁（fail-closed——有错误的图绝不 validated）、
 * 校验失败保持 draft 且具名错误落盘、版本 bump、tenant 隔离与持久化。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const TENANT = "tenant-acme";
const OTHER_TENANT = "tenant-globex";
const STORE_FILE = "mos-production-graphs.json";

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
  const dir = mkdtempSync(join(tmpdir(), "mos-graphs-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newStore(dir: string, time?: TimePort): GraphStore {
  return new GraphStore({ directory: dir, time });
}

/** 三节点链（transform → engine → review_gate）合法基准输入。 */
function validGraphInput(overrides: Partial<GraphInput> = {}): GraphInput {
  return {
    name: "caption then review",
    mission_id: null,
    nodes: [
      { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
      { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
      { id: "n3", kind: "review_gate", ref: null, parameters: {} },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
    ...overrides,
  };
}

/** 端口事实集：全部解析成功的合法图用 lookups（transform active + engine registered）。 */
const happyLookups = {
  transformLookup: ((_tenantId: string, transformId: string) =>
    transformId === "tr-caption" ? { status: "active" as const } : undefined) satisfies TransformLookup,
  engineLookup: ((_tenantId: string, engineId: string) =>
    engineId === "engine-local" ? { status: "registered" as const } : undefined) satisfies EngineLookup,
};

describe("GraphStore.saveDraft (draft lifecycle)", () => {
  test("missing file starts empty; saveDraft creates a version 1 draft with clean validation state", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    expect(store.listByTenant(TENANT)).toEqual([]);

    const draft = store.saveDraft(TENANT, "graph-1", validGraphInput());
    expect(draft.id).toBe("graph-1");
    expect(draft.version).toBe(1);
    expect(draft.status).toBe("draft");
    expect(draft.validated_at).toBeNull();
    expect(draft.validation_errors).toEqual([]);
    expect(draft.created_at).toBe(T1);
    expect(draft.updated_at).toBe(T1);
  });

  test("saveDraft with identical content is idempotent: no bump, no timestamp change, no rewrite", () => {
    const clock = new MutableClock(T1);
    const dir = newDir();
    const store = newStore(dir, clock);
    const first = store.saveDraft(TENANT, "graph-1", validGraphInput());
    const fileContent = readFileSync(join(dir, STORE_FILE), "utf8");

    clock.advance(T2);
    const again = store.saveDraft(TENANT, "graph-1", validGraphInput());
    expect(again).toEqual(first);
    expect(readFileSync(join(dir, STORE_FILE), "utf8")).toBe(fileContent);
  });

  test("saveDraft with changed content bumps version and resets validation state to draft", () => {
    const clock = new MutableClock(T1);
    const store = newStore(newDir(), clock);
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    // 先 validate 成功，再改动：校验状态必须显式重置（改动后的图必须重新过门禁）。
    store.validate(TENANT, "graph-1", happyLookups);
    expect(store.get(TENANT, "graph-1").status).toBe("validated");

    clock.advance(T2);
    const edited = store.saveDraft(TENANT, "graph-1", validGraphInput({ name: "edited" }));
    expect(edited.version).toBe(2);
    expect(edited.status).toBe("draft");
    expect(edited.validated_at).toBeNull();
    expect(edited.validation_errors).toEqual([]);
    expect(edited.created_at).toBe(T1);
    expect(edited.updated_at).toBe(T2);
  });

  test("cross-tenant upsert of the same graph id fails closed (InvariantViolation)", () => {
    const store = newStore(newDir());
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    expect(() =>
      store.saveDraft(OTHER_TENANT, "graph-1", validGraphInput({ name: "Other" })),
    ).toThrow(InvariantViolation);
    expect(store.get(TENANT, "graph-1").tenant_id).toBe(TENANT);
    expect(store.listByTenant(OTHER_TENANT)).toEqual([]);
  });

  test("get: unknown id -> GraphNotFoundError; other tenant's graph -> InvariantViolation", () => {
    const store = newStore(newDir());
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    expect(() => store.get(TENANT, "graph-missing")).toThrow(GraphNotFoundError);
    expect(() => store.get(OTHER_TENANT, "graph-1")).toThrow(InvariantViolation);
  });

  test("listByTenant only exposes the caller tenant's graphs", () => {
    const store = newStore(newDir());
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    store.saveDraft(OTHER_TENANT, "graph-2", validGraphInput({ name: "Other" }));
    expect(store.listByTenant(TENANT).map((graph) => graph.id)).toEqual(["graph-1"]);
    expect(store.listByTenant(OTHER_TENANT).map((graph) => graph.id)).toEqual(["graph-2"]);
  });
});

describe("GraphStore.validate (fail-closed gate)", () => {
  test("valid 3-node graph becomes validated with validated_at and empty errors", () => {
    const clock = new MutableClock(T1);
    const store = newStore(newDir(), clock);
    store.saveDraft(TENANT, "graph-1", validGraphInput());

    clock.advance(T2);
    const validated = store.validate(TENANT, "graph-1", happyLookups);
    expect(validated.status).toBe("validated");
    expect(validated.validated_at).toBe(T2);
    expect(validated.validation_errors).toEqual([]);
    expect(validated.updated_at).toBe(T2);
    expect(validated.version).toBe(1);
    expect(store.get(TENANT, "graph-1").status).toBe("validated");
  });

  test("validation failure keeps status draft and records the named errors (fail-closed)", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput());

    expect(() => store.validate(TENANT, "graph-1", {
      transformLookup: () => undefined,
      engineLookup: () => undefined,
    })).toThrow(GraphValidationError);

    const draft = store.get(TENANT, "graph-1");
    expect(draft.status).toBe("draft");
    expect(draft.validated_at).toBeNull();
    expect(draft.validation_errors).toContain("unresolved transform ref: tr-caption (node n1)");
    expect(draft.validation_errors).toContain("unresolved engine ref: engine-local (node n2)");
  });

  test("the thrown GraphValidationError carries the same named validation_errors as the record", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput());

    try {
      store.validate(TENANT, "graph-1", {
        transformLookup: () => undefined,
        engineLookup: () => undefined,
      });
      expect.unreachable("validate must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphValidationError);
      const graphError = error as GraphValidationError;
      expect(graphError.validationErrors).toEqual(store.get(TENANT, "graph-1").validation_errors);
    }
  });

  test("retired transform blocks validation (named error recorded, stays draft)", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput());

    expect(() =>
      store.validate(TENANT, "graph-1", {
        ...happyLookups,
        transformLookup: () => ({ status: "retired" as const }),
      }),
    ).toThrow(GraphValidationError);

    const draft = store.get(TENANT, "graph-1");
    expect(draft.status).toBe("draft");
    expect(draft.validation_errors).toContain(
      "transform not active: tr-caption status=retired (node n1)",
    );
  });

  test("deprecated engine blocks validation (named error recorded, stays draft)", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput());

    expect(() =>
      store.validate(TENANT, "graph-1", {
        ...happyLookups,
        engineLookup: () => ({ status: "deprecated" as const }),
      }),
    ).toThrow(GraphValidationError);

    const draft = store.get(TENANT, "graph-1");
    expect(draft.status).toBe("draft");
    expect(draft.validation_errors).toContain(
      "engine not usable: engine-local status=deprecated (node n2)",
    );
  });

  test("cycle blocks validation (named error recorded)", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput({
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n1" },
        { from: "n2", to: "n3" },
      ],
    }));

    expect(() => store.validate(TENANT, "graph-1", happyLookups)).toThrow(GraphValidationError);
    expect(store.get(TENANT, "graph-1").validation_errors).toContain(
      "cycle detected: n1 -> n2 -> n1",
    );
  });

  test("previously validated graph failing re-validation becomes invalidated (never stays validated with errors)", () => {
    const clock = new MutableClock(T1);
    const store = newStore(newDir(), clock);
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    store.validate(TENANT, "graph-1", happyLookups);
    expect(store.get(TENANT, "graph-1").status).toBe("validated");

    clock.advance(T2);
    // transform 被下线（retired）后重校验：原 validated 图必须降级 invalidated。
    expect(() =>
      store.validate(TENANT, "graph-1", {
        ...happyLookups,
        transformLookup: () => ({ status: "retired" as const }),
      }),
    ).toThrow(GraphValidationError);

    const invalidated = store.get(TENANT, "graph-1");
    expect(invalidated.status).toBe("invalidated");
    expect(invalidated.validated_at).toBeNull();
    expect(invalidated.validation_errors).toContain(
      "transform not active: tr-caption status=retired (node n1)",
    );
  });

  test("engine node with null ref can never validate (unresolved ref named; opaque-refs invariant holds)", () => {
    const store = newStore(newDir(), new MutableClock(T1));
    store.saveDraft(TENANT, "graph-1", validGraphInput({
      nodes: [
        { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
        { id: "n2", kind: "engine", ref: null, parameters: {} },
        { id: "n3", kind: "review_gate", ref: null, parameters: {} },
      ],
    }));

    expect(() => store.validate(TENANT, "graph-1", happyLookups)).toThrow(GraphValidationError);
    expect(store.get(TENANT, "graph-1").validation_errors).toContain(
      "engine node n2 has no ref: unresolved engine reference",
    );
  });

  test("validate: unknown graph -> GraphNotFoundError; other tenant's graph -> InvariantViolation", () => {
    const store = newStore(newDir());
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    expect(() => store.validate(TENANT, "graph-missing", happyLookups)).toThrow(GraphNotFoundError);
    expect(() => store.validate(OTHER_TENANT, "graph-1", happyLookups)).toThrow(
      InvariantViolation,
    );
  });

  test("draft-with-errors graph can be fixed, re-saved and re-validated (version bump)", () => {
    const clock = new MutableClock(T1);
    const store = newStore(newDir(), clock);
    store.saveDraft(TENANT, "graph-1", validGraphInput({
      nodes: [
        { id: "n1", kind: "transform", ref: "tr-missing", parameters: {} },
        { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        { id: "n3", kind: "review_gate", ref: null, parameters: {} },
      ],
    }));
    expect(() => store.validate(TENANT, "graph-1", happyLookups)).toThrow(GraphValidationError);

    clock.advance(T2);
    store.saveDraft(TENANT, "graph-1", validGraphInput());
    clock.advance(T3);
    const validated = store.validate(TENANT, "graph-1", happyLookups);
    expect(validated.status).toBe("validated");
    expect(validated.version).toBe(2);
    expect(validated.validation_errors).toEqual([]);
  });
});

describe("GraphStore (durability + corruption fail-closed)", () => {
  test("durability: a new store instance on the same directory reloads records; no tmp residue", () => {
    const dir = newDir();
    const first = newStore(dir, new MutableClock(T1));
    first.saveDraft(TENANT, "graph-1", validGraphInput());
    first.validate(TENANT, "graph-1", happyLookups);

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = newStore(dir, new MutableClock(T2));
    const reloaded = second.get(TENANT, "graph-1");
    expect(reloaded.status).toBe("validated");
    expect(reloaded.validated_at).toBe(T1);
    expect(reloaded.nodes.length).toBe(3);
  });

  test("corrupted store file (invalid JSON) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(join(dir, STORE_FILE), "{ not json", "utf8");
    expect(() => newStore(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("corrupted store file (wrong structure) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(join(dir, STORE_FILE), JSON.stringify({ version: 1 }), "utf8");
    expect(() => newStore(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("corrupted record (bad graph status in file) fails closed on read", () => {
    const dir = newDir();
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({
        version: 1,
        graphs: [
          {
            id: "graph-1",
            tenant_id: TENANT,
            mission_id: null,
            version: 1,
            name: "Broken",
            nodes: [],
            edges: [],
            status: "live",
            validated_at: null,
            validation_errors: [],
            created_at: T1,
            updated_at: T1,
          },
        ],
      }),
      "utf8",
    );
    expect(() => newStore(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });
});
