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
  rightsRecordSchema,
} from "@mos/contracts";
import {
  RightsGateService,
  RightsRecordNotFoundError,
  RightsRecordStore,
  RightsValidationError,
} from "../src/index.js";
import type { RightsRecordInput, TimePort } from "../src/index.js";

/**
 * RightsRecordStore / RightsGateService 矩阵：review_decision 追加式、
 * tenant 隔离（fail-closed）、listForArtifact 范围、持久化（原子写 / 损坏拒绝）
 * 与服务编排（注入时钟、未知 artifact fail-closed）。
 */

const NOW = "2026-11-13T12:00:00Z";
const LATER = "2026-11-13T18:00:00Z";
const STORE_FILE = "mos-rights-records.json";
const ARTIFACT = "artifact:art-1:1";

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-rights-policy-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 可变时钟：验证 gate 评估的 now 一律经注入 TimePort。 */
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

/** 写入输入（写边界 intake；id/created_at/updated_at 由 deps 提供）。 */
function baseInput(overrides: Partial<RightsRecordInput> = {}): RightsRecordInput {
  return {
    kind: "source_license",
    subject_ref: "asset-brief",
    subject_artifact_ref: ARTIFACT,
    constraints: [],
    evidence_refs: [],
    decision: "granted",
    decided_at: NOW,
    expires_at: LATER,
    ...overrides,
  };
}

function newStore(dir: string): RightsRecordStore {
  return new RightsRecordStore({ directory: dir });
}

describe("RightsRecordStore.saveRecord (upsert by id, verbatim intake)", () => {
  test("persists a record valid against the shared rightsRecordSchema; getRecord returns it", () => {
    const store = newStore(newDir());
    const saved = store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });

    expect(saved.id).toBe("rights-1");
    expect(saved.tenant_id).toBe("tenant-acme");
    expect(saved.decision).toBe("granted");
    expect(saved.subject_artifact_ref).toBe(ARTIFACT);
    expect(saved.created_at).toBe(NOW);
    expect(saved.updated_at).toBe(NOW);
    expect(() => rightsRecordSchema.parse(saved)).not.toThrow();
    expect(store.getRecord("tenant-acme", "rights-1")).toEqual(saved);
  });

  test("upsert by id replaces in place: created_at preserved, updated_at advances", () => {
    const store = newStore(newDir());
    store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });
    const updated = store.saveRecord(
      "tenant-acme",
      baseInput({ constraints: ["channel:youtube"], expires_at: null }),
      { id: "rights-1", now: LATER },
    );

    expect(store.listByTenant("tenant-acme")).toHaveLength(1);
    expect(updated.created_at).toBe(NOW);
    expect(updated.updated_at).toBe(LATER);
    expect(updated.constraints).toEqual(["channel:youtube"]);
    expect(updated.expires_at).toBeNull();
  });

  test("a new id appends a separate record (listByTenant grows)", () => {
    const store = newStore(newDir());
    store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });
    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "consent", subject_artifact_ref: null }),
      { id: "rights-2", now: NOW },
    );
    expect(store.listByTenant("tenant-acme").map((r) => r.id)).toEqual([
      "rights-1",
      "rights-2",
    ]);
  });

  test("input validation fails closed with RightsValidationError (typed enums, timestamps)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.saveRecord(
        "tenant-acme",
        baseInput({ kind: "unknown" as RightsRecordInput["kind"] }),
        { id: "rights-1", now: NOW },
      ),
    ).toThrow(RightsValidationError);
    expect(() =>
      store.saveRecord("tenant-acme", baseInput({ subject_ref: "" }), {
        id: "rights-2",
        now: NOW,
      }),
    ).toThrow(RightsValidationError);
    expect(() =>
      store.saveRecord(
        "tenant-acme",
        baseInput({ decided_at: "2026/11/13 12:00" }),
        { id: "rights-3", now: NOW },
      ),
    ).toThrow(RightsValidationError);
    expect(() =>
      store.saveRecord(
        "tenant-acme",
        baseInput({ subject_artifact_ref: "" }),
        { id: "rights-4", now: NOW },
      ),
    ).toThrow(RightsValidationError);
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });
});

describe("RightsRecordStore review_decision append-only (decision immutable per id)", () => {
  test("mutating an existing review_decision's decision throws RightsValidationError (matrix e)", () => {
    const store = newStore(newDir());
    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "granted" }),
      { id: "review-1", now: NOW },
    );

    expect(() =>
      store.saveRecord(
        "tenant-acme",
        baseInput({ kind: "review_decision", decision: "denied" }),
        { id: "review-1", now: LATER },
      ),
    ).toThrow(RightsValidationError);
    // 记录未被改写：仍是最初的 granted 决定。
    expect(store.getRecord("tenant-acme", "review-1").decision).toBe("granted");
    expect(store.listByTenant("tenant-acme")).toHaveLength(1);
  });

  test("changing a review_decision's kind (laundering attempt) fails closed", () => {
    const store = newStore(newDir());
    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "granted" }),
      { id: "review-1", now: NOW },
    );
    expect(() =>
      store.saveRecord(
        "tenant-acme",
        baseInput({ kind: "platform_policy", decision: "denied" }),
        { id: "review-1", now: LATER },
      ),
    ).toThrow(RightsValidationError);
    expect(store.getRecord("tenant-acme", "review-1").decision).toBe("granted");
  });

  test("re-saving with the same decision is allowed (e.g. extending expires_at)", () => {
    const store = newStore(newDir());
    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "granted", expires_at: NOW }),
      { id: "review-1", now: NOW },
    );
    const updated = store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "granted", expires_at: null }),
      { id: "review-1", now: LATER },
    );
    expect(updated.decision).toBe("granted");
    expect(updated.expires_at).toBeNull();
    expect(store.listByTenant("tenant-acme")).toHaveLength(1);
  });

  test("a NEW id is required to change a decision: appended record coexists with the old one", () => {
    const store = newStore(newDir());
    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "granted" }),
      { id: "review-1", now: NOW },
    );
    const appended = store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "denied" }),
      { id: "review-2", now: LATER },
    );
    expect(appended.decision).toBe("denied");
    expect(store.getRecord("tenant-acme", "review-1").decision).toBe("granted");
    expect(store.listByTenant("tenant-acme").map((r) => r.id)).toEqual([
      "review-1",
      "review-2",
    ]);
  });

  test("non-review kinds upsert freely (constraints evolve without append)", () => {
    const store = newStore(newDir());
    store.saveRecord("tenant-acme", baseInput({ kind: "platform_policy" }), {
      id: "policy-1",
      now: NOW,
    });
    const updated = store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "platform_policy", constraints: ["geo:eu-only"] }),
      { id: "policy-1", now: LATER },
    );
    expect(updated.constraints).toEqual(["geo:eu-only"]);
    expect(store.listByTenant("tenant-acme")).toHaveLength(1);
  });
});

describe("RightsRecordStore tenant boundary (fail-closed)", () => {
  test("cross-tenant read and write fail closed with InvariantViolation (matrix f)", () => {
    const store = newStore(newDir());
    store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });

    expect(() => store.getRecord("tenant-globex", "rights-1")).toThrow(InvariantViolation);
    expect(() =>
      store.saveRecord("tenant-globex", baseInput(), { id: "rights-1", now: LATER }),
    ).toThrow(InvariantViolation);
    // 跨租户写入未覆盖原记录。
    expect(store.getRecord("tenant-acme", "rights-1").tenant_id).toBe("tenant-acme");
  });

  test("getRecord on an unknown id throws RightsRecordNotFoundError", () => {
    const store = newStore(newDir());
    expect(() => store.getRecord("tenant-acme", "rights-missing")).toThrow(
      RightsRecordNotFoundError,
    );
  });

  test("listByTenant and listForArtifact scope to the caller tenant only (matrix g)", () => {
    const store = newStore(newDir());
    // tenant-acme：art-1 专属 granted + 通配 denied。
    store.saveRecord("tenant-acme", baseInput({ decision: "granted" }), {
      id: "acme-1",
      now: NOW,
    });
    store.saveRecord(
      "tenant-acme",
      baseInput({ subject_artifact_ref: null, decision: "denied", kind: "platform_policy" }),
      { id: "acme-2", now: NOW },
    );
    // tenant-acme：另一 artifact 的记录（不覆盖 art-1）。
    store.saveRecord(
      "tenant-acme",
      baseInput({ subject_artifact_ref: "artifact:art-9:1" }),
      { id: "acme-3", now: NOW },
    );
    // tenant-globex：art-1 的记录（对 tenant-acme 不可见）。
    store.saveRecord(
      "tenant-globex",
      baseInput({ decision: "denied" }),
      { id: "globex-1", now: NOW },
    );

    expect(store.listByTenant("tenant-acme").map((r) => r.id)).toEqual([
      "acme-1",
      "acme-2",
      "acme-3",
    ]);
    expect(store.listByTenant("tenant-globex").map((r) => r.id)).toEqual(["globex-1"]);

    // listForArtifact = 精确覆盖 + null 通配，且只含本租户记录。
    expect(store.listForArtifact("tenant-acme", ARTIFACT).map((r) => r.id)).toEqual([
      "acme-1",
      "acme-2",
    ]);
    expect(store.listForArtifact("tenant-globex", ARTIFACT).map((r) => r.id)).toEqual([
      "globex-1",
    ]);
    // 未知 artifact：精确记录不存在，但 null 通配记录（acme-2）按设计覆盖全部
    // artifact——通配 = 平台级政策；真正的 fail-closed 判定在门禁（gate）层。
    expect(store.listForArtifact("tenant-acme", "artifact:art-none:1").map((r) => r.id)).toEqual([
      "acme-2",
    ]);
  });
});

describe("RightsRecordStore persistence (durable, atomic, fail-closed on corruption)", () => {
  test("a new store instance reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    const first = newStore(dir);
    const saved = first.saveRecord("tenant-acme", baseInput(), {
      id: "rights-1",
      now: NOW,
    });
    first.saveRecord("tenant-acme", baseInput({ kind: "consent" }), {
      id: "rights-2",
      now: NOW,
    });

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const reloaded = newStore(dir);
    expect(reloaded.listByTenant("tenant-acme")).toHaveLength(2);
    expect(reloaded.getRecord("tenant-acme", "rights-1")).toEqual(saved);
  });

  test("missing file starts empty", () => {
    const store = newStore(newDir());
    expect(store.listByTenant("tenant-acme")).toEqual([]);
    expect(store.listForArtifact("tenant-acme", ARTIFACT)).toEqual([]);
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
      JSON.stringify({ version: 1, rights_records: "nope" }),
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
        rights_records: [{ id: "rights-x", tenant_id: "tenant-acme" }],
      }),
      "utf8",
    );
    // 读边界绝不静默补全：缺键的记录 fail-closed。
    expect(() => newStore(missingKeys).listByTenant("tenant-acme")).toThrow(
      ContractValidationError,
    );
  });
});

describe("RightsGateService (store-backed, injected clock, fail-closed)", () => {
  test("granted + unexpired record clears the artifact via the injected clock", () => {
    const store = newStore(newDir());
    const clock = new MutableClock(NOW);
    const service = new RightsGateService({ store, time: clock });

    store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });
    expect(service.evaluateForArtifact("tenant-acme", ARTIFACT)).toEqual({
      cleared: true,
      reason: "granted",
    });
    // 通配记录（subject_artifact_ref = null）覆盖任意 artifact。
    store.saveRecord(
      "tenant-acme",
      baseInput({ subject_artifact_ref: null, kind: "consent" }),
      { id: "rights-2", now: NOW },
    );
    expect(service.evaluateForArtifact("tenant-acme", "artifact:art-7:1")).toEqual({
      cleared: true,
      reason: "granted",
    });
  });

  test("the injected clock drives expiry (expires_at == now is EXPIRED, matrix d)", () => {
    const store = newStore(newDir());
    const clock = new MutableClock(NOW);
    const service = new RightsGateService({ store, time: clock });

    store.saveRecord("tenant-acme", baseInput({ expires_at: LATER }), {
      id: "rights-1",
      now: NOW,
    });
    expect(service.evaluateForArtifact("tenant-acme", ARTIFACT).cleared).toBe(true);

    // expires_at === now → expired（严格 > now 才有效）。
    clock.advance(LATER);
    expect(service.evaluateForArtifact("tenant-acme", ARTIFACT)).toEqual({
      cleared: false,
      reason: "expired",
    });
  });

  test("pending and denied records deny with named reasons", () => {
    const store = newStore(newDir());
    const service = new RightsGateService({ store, time: new MutableClock(NOW) });

    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "pending", decided_at: null }),
      { id: "review-1", now: NOW },
    );
    expect(service.evaluateForArtifact("tenant-acme", ARTIFACT)).toEqual({
      cleared: false,
      reason: "decision_pending",
    });

    store.saveRecord(
      "tenant-acme",
      baseInput({ kind: "review_decision", decision: "denied" }),
      { id: "review-2", now: NOW },
    );
    expect(service.evaluateForArtifact("tenant-acme", ARTIFACT)).toEqual({
      cleared: false,
      reason: "explicit_denial",
    });
  });

  test("an unknown artifact denies fail-closed (no covering record)", () => {
    const store = newStore(newDir());
    const service = new RightsGateService({ store, time: new MutableClock(NOW) });
    store.saveRecord("tenant-acme", baseInput(), { id: "rights-1", now: NOW });

    expect(service.evaluateForArtifact("tenant-acme", "artifact:unknown:1")).toEqual({
      cleared: false,
      reason: "no_covering_record",
    });
    // 其他租户的记录对该租户不可见 → 同样 fail-closed 拒绝。
    expect(service.evaluateForArtifact("tenant-globex", ARTIFACT)).toEqual({
      cleared: false,
      reason: "no_covering_record",
    });
  });
});
