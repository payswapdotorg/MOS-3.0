import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import { DistributionIntentStore } from "../src/index.js";
import {
  IdempotencyConflictError,
  IntentNotFoundError,
  IntentTransitionError,
  IntentValidationError,
  PreviewRequiredError,
} from "../src/index.js";
import {
  baseInput,
  baseIntent,
  EVIDENCE_REF,
  EVIDENCE_REF_2,
  handBuiltIntent,
  OTHER_TENANT,
  PREVIEW_HASH,
  PREVIEW_REF,
  STORE_FILE,
  T1,
  T2,
  T3,
  TENANT,
} from "./fixtures.js";

/**
 * DistributionIntentStore 矩阵：创建/幂等/租户隔离、完整生命周期落盘、
 * 门禁在写边界生效（未绑定已批准预览的 executing/succeeded 不可写）、
 * durability 与损坏 fail-closed。
 */

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-distribution-intents-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newStore(dir: string): DistributionIntentStore {
  return new DistributionIntentStore({ directory: dir });
}

/** 预置一个 status=executing 且已绑定已批准预览的意图（完整合法链路）。 */
function seedExecuting(store: DistributionIntentStore, id = "intent-1") {
  store.createIntent(TENANT, baseInput(), { now: T1, id });
  store.bindPreview(TENANT, id, { preview_ref: PREVIEW_REF, preview_hash: PREVIEW_HASH }, { now: T2 });
  store.applyTransition(TENANT, id, "pending_approval", { now: T2 });
  store.applyTransition(TENANT, id, "approved", { now: T2 });
  return store.applyTransition(TENANT, id, "executing", { now: T3 });
}

describe("DistributionIntentStore.createIntent", () => {
  test("persists a status=intent record and survives store restarts (durable)", () => {
    const dir = newDir();
    const created = newStore(dir).createIntent(TENANT, baseInput(), {
      now: T1,
      id: "intent-1",
    });
    expect(created.status).toBe("intent");
    expect(created.approval_state).toBe("pending");

    const reloaded = newStore(dir).getIntent(TENANT, "intent-1");
    expect(reloaded).toEqual(created);
  });

  test("schema-invalid input fails closed with IntentValidationError and persists nothing", () => {
    const store = newStore(newDir());
    expect(() =>
      store.createIntent(TENANT, baseInput({ operation: "explode" as never }), {
        now: T1,
        id: "intent-1",
      }),
    ).toThrow(IntentValidationError);
    expect(store.listIntentsByTenant(TENANT)).toEqual([]);
  });

  test("input tenant mismatch with the caller fails closed with InvariantViolation", () => {
    const store = newStore(newDir());
    expect(() =>
      store.createIntent(OTHER_TENANT, baseInput({ tenant_id: TENANT }), {
        now: T1,
        id: "intent-1",
      }),
    ).toThrow(InvariantViolation);
    expect(store.listIntentsByTenant(TENANT)).toEqual([]);
    expect(store.listIntentsByTenant(OTHER_TENANT)).toEqual([]);
  });
});

describe("idempotency keys (per-tenant uniqueness)", () => {
  test("a duplicate key within a tenant conflicts and names the existing intent", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput({ idempotency_key: "idem-1" }), {
      now: T1,
      id: "intent-1",
    });
    const error = captureIdempotencyConflict(() =>
      store.createIntent(TENANT, baseInput({ idempotency_key: "idem-1" }), {
        now: T2,
        id: "intent-2",
      }),
    );
    expect(error?.existingIntentId).toBe("intent-1");
    expect(store.listIntentsByTenant(TENANT).map((intent) => intent.id)).toEqual([
      "intent-1",
    ]);
  });

  test("the same key retrying the same id also conflicts (no silent overwrite)", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput({ idempotency_key: "idem-1" }), {
      now: T1,
      id: "intent-1",
    });
    expect(() =>
      store.createIntent(TENANT, baseInput({ idempotency_key: "idem-1" }), {
        now: T2,
        id: "intent-1",
      }),
    ).toThrow(IdempotencyConflictError);
  });

  test("the same key in another tenant does not conflict; absent keys never conflict", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput({ idempotency_key: "idem-1" }), {
      now: T1,
      id: "intent-1",
    });
    const foreign = store.createIntent(
      OTHER_TENANT,
      baseInput({ tenant_id: OTHER_TENANT, idempotency_key: "idem-1" }),
      { now: T1, id: "intent-globex-1" },
    );
    expect(foreign.idempotency_key).toBe("idem-1");

    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-2" });
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-3" });
    expect(store.listIntentsByTenant(TENANT).length).toBe(3);
    expect(store.listIntentsByTenant(OTHER_TENANT).length).toBe(1);
  });
});

describe("DistributionIntentStore lifecycle (write boundary)", () => {
  test("full happy path persists every step and ends succeeded with evidence refs", () => {
    const dir = newDir();
    const store = newStore(dir);
    seedExecuting(store);

    const withEvidence = store.recordExecution(TENANT, "intent-1", EVIDENCE_REF, {
      now: T3,
    });
    expect(withEvidence.execution_records).toEqual([EVIDENCE_REF]);

    const succeeded = store.applyTransition(TENANT, "intent-1", "succeeded", {
      now: T3,
    });
    const more = store.recordExecution(TENANT, "intent-1", EVIDENCE_REF_2, { now: T3 });
    expect(more.status).toBe("succeeded");
    expect(more.execution_records).toEqual([EVIDENCE_REF, EVIDENCE_REF_2]);
    expect(more.preview_ref).toBe(PREVIEW_REF);
    expect(more.approval_state).toBe("approved");

    // durability：重启后证据引用仍然在。
    expect(newStore(dir).getIntent(TENANT, "intent-1")?.execution_records).toEqual([
      EVIDENCE_REF,
      EVIDENCE_REF_2,
    ]);
  });

  test("executing without approved preview is unwritable (store-level fail-closed)", () => {
    const dir = newDir();
    // 直接落一个 schema 合法但违反不变量 §22 的记录（executing 且未绑定预览）。
    const corrupt = handBuiltIntent({ id: "intent-corrupt", status: "executing" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({ version: 1, intents: [corrupt] }),
      "utf8",
    );
    const store = newStore(dir);

    expect(() =>
      store.applyTransition(TENANT, "intent-corrupt", "succeeded", { now: T3 }),
    ).toThrow(InvariantViolation);
    expect(() =>
      store.recordExecution(TENANT, "intent-corrupt", EVIDENCE_REF, { now: T3 }),
    ).toThrow(InvariantViolation);
    expect(store.getIntent(TENANT, "intent-corrupt")?.status).toBe("executing");
  });

  test("applyTransition to previewed without bindPreview fails closed (PreviewRequiredError)", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    expect(() =>
      store.applyTransition(TENANT, "intent-1", "previewed", { now: T2 }),
    ).toThrow(PreviewRequiredError);
    expect(store.getIntent(TENANT, "intent-1")?.status).toBe("intent");
  });

  test("rejected intents cannot execute through the store", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    store.bindPreview(
      TENANT,
      "intent-1",
      { preview_ref: PREVIEW_REF, preview_hash: PREVIEW_HASH },
      { now: T2 },
    );
    store.applyTransition(TENANT, "intent-1", "pending_approval", { now: T2 });
    const rejected = store.applyTransition(TENANT, "intent-1", "rejected", { now: T2 });
    expect(rejected.status).toBe("rejected");

    const error = captureTransition(() =>
      store.applyTransition(TENANT, "intent-1", "executing", { now: T3 }),
    );
    expect(error?.current).toBe("rejected");
    expect(error?.target).toBe("executing");
  });

  test("skipping states through the store is rejected (IntentTransitionError)", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    expect(() =>
      store.applyTransition(TENANT, "intent-1", "approved", { now: T2 }),
    ).toThrow(IntentTransitionError);
    expect(store.getIntent(TENANT, "intent-1")?.status).toBe("intent");
  });
});

describe("DistributionIntentStore reads and tenant isolation", () => {
  test("getIntent: unknown id → null; another tenant's record → InvariantViolation", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    expect(store.getIntent(TENANT, "intent-missing")).toBeNull();
    expect(() => store.getIntent(OTHER_TENANT, "intent-1")).toThrow(InvariantViolation);
  });

  test("mutations on an unknown id fail closed with IntentNotFoundError", () => {
    const store = newStore(newDir());
    expect(() =>
      store.applyTransition(TENANT, "intent-missing", "previewed", { now: T2 }),
    ).toThrow(IntentNotFoundError);
    expect(() =>
      store.bindPreview(
        TENANT,
        "intent-missing",
        { preview_ref: PREVIEW_REF, preview_hash: PREVIEW_HASH },
        { now: T2 },
      ),
    ).toThrow(IntentNotFoundError);
    expect(() =>
      store.recordExecution(TENANT, "intent-missing", EVIDENCE_REF, { now: T3 }),
    ).toThrow(IntentNotFoundError);
  });

  test("cross-tenant mutations fail closed (record exists but belongs to another tenant)", () => {
    const store = newStore(newDir());
    store.createIntent(OTHER_TENANT, baseInput({ tenant_id: OTHER_TENANT }), {
      now: T1,
      id: "intent-globex-1",
    });
    expect(() =>
      store.bindPreview(
        TENANT,
        "intent-globex-1",
        { preview_ref: PREVIEW_REF, preview_hash: PREVIEW_HASH },
        { now: T2 },
      ),
    ).toThrow(InvariantViolation);
    expect(() =>
      store.applyTransition(TENANT, "intent-globex-1", "pending_approval", { now: T2 }),
    ).toThrow(InvariantViolation);
    expect(() =>
      store.recordExecution(TENANT, "intent-globex-1", EVIDENCE_REF, { now: T3 }),
    ).toThrow(InvariantViolation);
  });

  test("listIntentsByTenant only returns the caller tenant's records", () => {
    const store = newStore(newDir());
    store.createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    store.createIntent(OTHER_TENANT, baseInput({ tenant_id: OTHER_TENANT }), {
      now: T1,
      id: "intent-globex-1",
    });
    expect(store.listIntentsByTenant(TENANT).map((intent) => intent.id)).toEqual([
      "intent-1",
    ]);
    expect(store.listIntentsByTenant(OTHER_TENANT).map((intent) => intent.id)).toEqual([
      "intent-globex-1",
    ]);
  });
});

describe("durability and corruption (fail-closed)", () => {
  test("atomic write leaves no tmp residue and the store file is the expected name", () => {
    const dir = newDir();
    newStore(dir).createIntent(TENANT, baseInput(), { now: T1, id: "intent-1" });
    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).listIntentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_FILE),
      JSON.stringify({ version: 1, intents: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listIntentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );

    const schemaCorrupt = newDir();
    mkdirSync(schemaCorrupt, { recursive: true });
    writeFileSync(
      join(schemaCorrupt, STORE_FILE),
      JSON.stringify({ version: 1, intents: [baseIntent({ artifact_ref: "" })] }),
      "utf8",
    );
    expect(() => newStore(schemaCorrupt).listIntentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );
  });

  test("a missing store file starts empty (no error)", () => {
    const store = newStore(newDir());
    expect(store.listIntentsByTenant(TENANT)).toEqual([]);
    expect(store.getIntent(TENANT, "intent-1")).toBeNull();
  });
});

/** 捕获 IdempotencyConflictError（未抛错则 undefined）。 */
function captureIdempotencyConflict(
  run: () => unknown,
): InstanceType<typeof IdempotencyConflictError> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return error;
    throw error;
  }
  return undefined;
}

/** 捕获 IntentTransitionError（未抛错则 undefined）。 */
function captureTransition(
  run: () => unknown,
): InstanceType<typeof IntentTransitionError> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof IntentTransitionError) return error;
    throw error;
  }
  return undefined;
}
