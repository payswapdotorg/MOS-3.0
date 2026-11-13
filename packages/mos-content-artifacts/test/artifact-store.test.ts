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
  artifactSchema,
  ContractValidationError,
  InvariantViolation,
} from "@mos/contracts";
import type { Artifact } from "@mos/contracts";
import {
  ArtifactNotFoundError,
  ArtifactStore,
  ArtifactValidationError,
  ArtifactVersionConflictError,
} from "../src/index.js";
import type { ArtifactVersionInput } from "../src/index.js";

/**
 * ArtifactStore 矩阵：不可变版本链（首版本门禁 / 严格 +1 / 血缘逐字携带）、
 * tenant 隔离（fail-closed）、持久化（原子写 / 损坏文件拒绝）与 provenance 必填。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const STORE_FILE = "mos-artifacts.json";

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-content-artifacts-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 版本注册输入（写边界 intake；provenance 必填且至少一条）。 */
function baseInput(overrides: Partial<ArtifactVersionInput> = {}): ArtifactVersionInput {
  return {
    id: "art-1",
    kind: "draft",
    content_ref: "content-store/art-1/v1",
    parent_artifact_refs: [],
    provenance: [{ source: "user-upload", observed_at: T1 }],
    rights_status: "unknown",
    quality_status: "unreviewed",
    created_by: { actor_kind: "human", actor_id: "user-1" },
    ...overrides,
  };
}

function newStore(dir: string): ArtifactStore {
  return new ArtifactStore({ directory: dir });
}

describe("ArtifactStore.registerFirstVersion (version 1, empty lineage, fail-closed)", () => {
  test("registers version 1 with empty parent refs and verbatim provenance (matrix a)", () => {
    const store = newStore(newDir());
    const first = store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });

    expect(first.version).toBe(1);
    expect(first.parent_artifact_refs).toEqual([]);
    expect(first.provenance).toEqual([{ source: "user-upload", observed_at: T1 }]);
    expect(first.kind).toBe("draft");
    expect(first.content_ref).toBe("content-store/art-1/v1");
    expect(first.rights_status).toBe("unknown");
    expect(first.quality_status).toBe("unreviewed");
    expect(first.created_by).toEqual({ actor_kind: "human", actor_id: "user-1" });
    expect(first.created_at).toBe(T1);
    expect(first.transform_id).toBeNull();
    // 产物符合共享契约。
    expect(() => artifactSchema.parse(first)).not.toThrow();
    expect(store.getVersion("tenant-acme", "art-1", 1)).toEqual(first);
  });

  test("rejects a first version carrying parent refs (first version lineage must be empty)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({ parent_artifact_refs: ["artifact:root:1"] }),
        { now: T1 },
      ),
    ).toThrow(ArtifactVersionConflictError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("rejects re-registering the first version of an existing artifact", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    expect(() =>
      store.registerFirstVersion("tenant-acme", baseInput(), { now: T2 }),
    ).toThrow(ArtifactVersionConflictError);
    // 首版本记录未被覆盖。
    expect(store.getVersion("tenant-acme", "art-1", 1).created_at).toBe(T1);
    expect(store.listByTenant("tenant-acme")).toHaveLength(1);
  });

  test("rejects a cross-tenant write onto an existing artifact id (InvariantViolation)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    expect(() =>
      store.registerFirstVersion("tenant-globex", baseInput(), { now: T2 }),
    ).toThrow(InvariantViolation);
    expect(store.listByTenant("tenant-globex")).toEqual([]);
  });
});

describe("ArtifactStore.registerNextVersion (strictly +1, lineage carried verbatim)", () => {
  test("walks v1 -> v2 -> v3 with the lineage carried; latest tracks the chain (matrix b)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });

    const v2 = store.registerNextVersion(
      "tenant-acme",
      baseInput({
        content_ref: "content-store/art-1/v2",
        quality_status: "approved",
        provenance: [{ source: "human-review", observed_at: T2 }],
      }),
      { now: T2 },
    );
    expect(v2.version).toBe(2);
    expect(v2.parent_artifact_refs).toEqual([]);
    expect(v2.quality_status).toBe("approved");
    expect(v2.created_at).toBe(T2);

    const v3 = store.registerNextVersion(
      "tenant-acme",
      baseInput({
        content_ref: "content-store/art-1/v3",
        provenance: [{ source: "human-review", observed_at: T3 }],
      }),
      { now: T3 },
    );
    expect(v3.version).toBe(3);
    expect(v3.parent_artifact_refs).toEqual([]);

    // 全链可读；latest = v3；每个记录都符合共享契约。
    expect(store.getVersion("tenant-acme", "art-1", 1).version).toBe(1);
    expect(store.getVersion("tenant-acme", "art-1", 2)).toEqual(v2);
    expect(store.getVersion("tenant-acme", "art-1", 3)).toEqual(v3);
    expect(store.latestVersion("tenant-acme", "art-1").version).toBe(3);
    for (const record of store.listByTenant("tenant-acme")) {
      expect(() => artifactSchema.parse(record)).not.toThrow();
    }
  });

  test("assigns the version from the chain: after v1 the only creatable version is v2 (matrix c, store level)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    // 版本号由版本链推导（nextVersion）：调用方无法表达 v3 跳级。
    const v2 = store.registerNextVersion("tenant-acme", baseInput(), { now: T2 });
    expect(v2.version).toBe(2);
    const v3 = store.registerNextVersion("tenant-acme", baseInput(), { now: T3 });
    expect(v3.version).toBe(3);
    // v1..v3 各只有一条记录（重复版本不可写）。
    expect(store.listByTenant("tenant-acme").map((r) => r.version)).toEqual([1, 2, 3]);
  });

  test("rejects a lineage mutation attempt (different parent refs) with ArtifactVersionConflictError (matrix d)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });

    expect(() =>
      store.registerNextVersion(
        "tenant-acme",
        baseInput({ parent_artifact_refs: ["artifact:other:1"] }),
        { now: T2 },
      ),
    ).toThrow(ArtifactVersionConflictError);
    // 冲突后版本链未受损：latest 仍是 v1，正确血缘仍可注册 v2。
    expect(store.latestVersion("tenant-acme", "art-1").version).toBe(1);
    const v2 = store.registerNextVersion("tenant-acme", baseInput(), { now: T2 });
    expect(v2.version).toBe(2);
  });

  test("fails closed with ArtifactNotFoundError for an unknown artifact", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerNextVersion("tenant-acme", baseInput(), { now: T1 }),
    ).toThrow(ArtifactNotFoundError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("rejects appending onto another tenant's artifact chain (cross-tenant write, InvariantViolation)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    expect(() =>
      store.registerNextVersion("tenant-globex", baseInput(), { now: T2 }),
    ).toThrow(InvariantViolation);
    expect(store.listByTenant("tenant-globex")).toEqual([]);
    expect(store.latestVersion("tenant-acme", "art-1").version).toBe(1);
  });
});

describe("ArtifactStore reads (tenant-scoped, fail-closed)", () => {
  test("getVersion: unknown id/version -> ArtifactNotFoundError; cross-tenant -> InvariantViolation (matrix e)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });

    expect(() => store.getVersion("tenant-acme", "art-missing", 1)).toThrow(
      ArtifactNotFoundError,
    );
    expect(() => store.getVersion("tenant-acme", "art-1", 9)).toThrow(ArtifactNotFoundError);
    expect(() => store.getVersion("tenant-globex", "art-1", 1)).toThrow(InvariantViolation);
    expect(() => store.latestVersion("tenant-globex", "art-1")).toThrow(InvariantViolation);
    expect(() => store.latestVersion("tenant-acme", "art-missing")).toThrow(
      ArtifactNotFoundError,
    );
  });

  test("listByTenant and listChildren scope to the caller tenant only (matrix h)", () => {
    const store = newStore(newDir());
    store.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    store.registerFirstVersion(
      "tenant-acme",
      baseInput({ id: "art-2", kind: "media" }),
      { now: T1 },
    );
    store.registerNextVersion("tenant-acme", baseInput({ id: "art-2" }), { now: T2 });
    store.registerFirstVersion(
      "tenant-globex",
      baseInput({ id: "art-3", content_ref: "content-store/art-3/v1" }),
      { now: T1 },
    );

    expect(store.listByTenant("tenant-acme").map((r) => r.id)).toEqual([
      "art-1",
      "art-2",
      "art-2",
    ]);
    expect(store.listByTenant("tenant-globex").map((r) => r.id)).toEqual(["art-3"]);
    // 本包写边界产出的血缘恒为空：无任何子记录。
    expect(store.listChildren("tenant-acme", "artifact:art-1:1")).toEqual([]);
  });

  test("listChildren surfaces only tenant-scoped records carrying the parent ref (opaque exact match)", () => {
    const dir = newDir();
    // 组合根写入形态的派生记录（共享 schema 允许非空血缘；读取面支持）：
    const foreignChild: Artifact = {
      id: "art-derived",
      tenant_id: "tenant-globex",
      kind: "derivative",
      version: 1,
      content_ref: "content-store/art-derived/v1",
      parent_artifact_refs: ["artifact:art-root:1"],
      transform_id: null,
      created_by: { actor_kind: "agent", actor_id: "mos" },
      provenance: [{ source: "transform-output", observed_at: T1 }],
      rights_status: "unknown",
      quality_status: "unreviewed",
      created_at: T1,
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({ version: 1, artifacts: [foreignChild] }, null, 2),
      "utf8",
    );

    const store = newStore(dir);
    expect(store.listChildren("tenant-globex", "artifact:art-root:1")).toEqual([
      foreignChild,
    ]);
    // tenant 隔离：其他租户查同一 parent ref 看不到该记录。
    expect(store.listChildren("tenant-acme", "artifact:art-root:1")).toEqual([]);
    expect(store.listChildren("tenant-globex", "artifact:art-other:1")).toEqual([]);
  });
});

describe("ArtifactStore validation (fail-closed, no silent defaults)", () => {
  test("provenance is required: empty array rejected (matrix g)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerFirstVersion("tenant-acme", baseInput({ provenance: [] }), { now: T1 }),
    ).toThrow(ArtifactValidationError);
  });

  test("provenance entries require source + observed_at (RFC3339 UTC)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({
          provenance: [
            { source: "user-upload", observed_at: "2026/11/13 00:00" },
          ] as ArtifactVersionInput["provenance"],
        }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({
          provenance: [{ source: "", observed_at: T1 }] as ArtifactVersionInput["provenance"],
        }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
  });

  test("content_ref is an opaque reference only: empty or token-shaped values rejected (no content bytes)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerFirstVersion("tenant-acme", baseInput({ content_ref: "" }), { now: T1 }),
    ).toThrow(ArtifactValidationError);
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({ content_ref: "sk-live-secret-token" }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
  });

  test("typed enums are enforced (kind / rights_status / quality_status)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({ kind: "spaceship" as ArtifactVersionInput["kind"] }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({ rights_status: "granted" as ArtifactVersionInput["rights_status"] }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
    expect(() =>
      store.registerFirstVersion(
        "tenant-acme",
        baseInput({ quality_status: "draft" as ArtifactVersionInput["quality_status"] }),
        { now: T1 },
      ),
    ).toThrow(ArtifactValidationError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });
});

describe("ArtifactStore persistence (durable, atomic, fail-closed on corruption)", () => {
  test("reloads the whole version chain in a new store instance; atomic write leaves no tmp residue (matrix f)", () => {
    const dir = newDir();
    const first = newStore(dir);
    first.registerFirstVersion("tenant-acme", baseInput(), { now: T1 });
    first.registerNextVersion("tenant-acme", baseInput(), { now: T2 });
    first.registerNextVersion("tenant-acme", baseInput(), { now: T3 });

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const reloaded = newStore(dir);
    expect(reloaded.listByTenant("tenant-acme").map((r) => r.version)).toEqual([1, 2, 3]);
    expect(reloaded.getVersion("tenant-acme", "art-1", 1)).toEqual(
      first.getVersion("tenant-acme", "art-1", 1),
    );
    expect(reloaded.latestVersion("tenant-acme", "art-1").version).toBe(3);
  });

  test("missing file starts empty", () => {
    const store = newStore(newDir());
    expect(store.listByTenant("tenant-acme")).toEqual([]);
    expect(store.listChildren("tenant-acme", "artifact:any:1")).toEqual([]);
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).listByTenant("tenant-acme")).toThrow(
      ContractValidationError,
    );

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_FILE),
      JSON.stringify({ version: 1, artifacts: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listByTenant("tenant-acme")).toThrow(
      ContractValidationError,
    );

    const missingKeys = newDir();
    mkdirSync(missingKeys, { recursive: true });
    writeFileSync(
      join(missingKeys, STORE_FILE),
      JSON.stringify({
        version: 1,
        artifacts: [{ id: "art-x", tenant_id: "tenant-acme" }],
      }),
      "utf8",
    );
    // 读边界绝不静默补全：缺键的记录 fail-closed。
    expect(() => newStore(missingKeys).listByTenant("tenant-acme")).toThrow(
      ContractValidationError,
    );
  });
});
