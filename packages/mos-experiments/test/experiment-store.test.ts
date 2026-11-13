import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import { ExperimentStore } from "../src/index.js";
import {
  ExperimentNotFoundError,
  ExperimentTransitionError,
  ExperimentValidationError,
  HypothesisAdoptionError,
  OutcomeEvidenceRequiredError,
} from "../src/index.js";
import {
  ASSIGNMENT_RECORD,
  baseExperiment,
  baseInput,
  CONCLUDED_AT,
  EVIDENCE_REF,
  EVIDENCE_REF_2,
  handBuiltExperiment,
  MISSION_ID,
  OTHER_MISSION_ID,
  OTHER_TENANT,
  STORE_FILE,
  T1,
  T2,
  T3,
  TENANT,
} from "./fixtures.js";

/**
 * ExperimentStore 矩阵：define/get/list、完整生命周期落盘（outcome 只经 conclude）、
 * outcome-without-evidence 不可写（store 级 fail-closed）、tenant 隔离、
 * durability 与损坏 fail-closed。
 */

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-experiments-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newStore(dir: string): ExperimentStore {
  return new ExperimentStore({ directory: dir });
}

function concludeInput(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "succeeded" as const,
    outcome_note: null,
    evidence_refs: [EVIDENCE_REF, EVIDENCE_REF_2],
    concluded_at: CONCLUDED_AT,
    ...overrides,
  };
}

describe("ExperimentStore.define", () => {
  test("persists a status=defined record and survives store restarts (durable)", () => {
    const dir = newDir();
    const defined = newStore(dir).define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    expect(defined.status).toBe("defined");
    expect(defined.outcome).toBeNull();
    expect(defined.measurement_evidence_refs).toEqual([]);

    const reloaded = newStore(dir).getExperiment(TENANT, "exp-1");
    expect(reloaded).toEqual(defined);
  });

  test("schema-invalid input fails closed with ExperimentValidationError and persists nothing", () => {
    const store = newStore(newDir());
    expect(() =>
      store.define(TENANT, baseInput({ statement: "" }), { now: T1, id: "exp-1" }),
    ).toThrow(ExperimentValidationError);
    expect(store.listExperimentsByTenant(TENANT)).toEqual([]);
  });

  test("input tenant mismatch with the caller fails closed with InvariantViolation", () => {
    const store = newStore(newDir());
    expect(() =>
      store.define(OTHER_TENANT, baseInput({ tenant_id: TENANT }), { now: T1, id: "exp-1" }),
    ).toThrow(InvariantViolation);
    expect(store.listExperimentsByTenant(TENANT)).toEqual([]);
    expect(store.listExperimentsByTenant(OTHER_TENANT)).toEqual([]);
  });
});

describe("ExperimentStore lifecycle (outcome authority)", () => {
  test("full happy path: define → assigned → measuring → analyzed → concluded with evidence", () => {
    const dir = newDir();
    const store = newStore(dir);
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    store.applyTransition(
      TENANT,
      "exp-1",
      { target: "assigned", assignment: ASSIGNMENT_RECORD },
      { now: T2 },
    );
    store.applyTransition(TENANT, "exp-1", { target: "measuring" }, { now: T3 });
    store.applyTransition(TENANT, "exp-1", { target: "analyzed" }, { now: T3 });
    const concluded = store.conclude(TENANT, "exp-1", concludeInput(), { now: CONCLUDED_AT });

    expect(concluded.status).toBe("concluded");
    expect(concluded.outcome).toBe("succeeded");
    expect(concluded.measurement_evidence_refs).toEqual([EVIDENCE_REF, EVIDENCE_REF_2]);
    expect(concluded.concluded_at).toBe(CONCLUDED_AT);

    // durability：重启后结论与证据仍然在。
    const reloaded = newStore(dir).getExperiment(TENANT, "exp-1");
    expect(reloaded).toEqual(concluded);
    expect(reloaded?.outcome).toBe("succeeded");
  });

  test("conclude without evidence fails closed with OutcomeEvidenceRequiredError", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    store.applyTransition(
      TENANT,
      "exp-1",
      { target: "assigned", assignment: ASSIGNMENT_RECORD },
      { now: T2 },
    );
    store.applyTransition(TENANT, "exp-1", { target: "measuring" }, { now: T3 });
    store.applyTransition(TENANT, "exp-1", { target: "analyzed" }, { now: T3 });

    expect(() =>
      store.conclude(TENANT, "exp-1", concludeInput({ evidence_refs: [] }), {
        now: CONCLUDED_AT,
      }),
    ).toThrow(OutcomeEvidenceRequiredError);
    const still = store.getExperiment(TENANT, "exp-1");
    expect(still?.status).toBe("analyzed");
    expect(still?.outcome).toBeNull();
  });

  test("conclude from a non-analyzed status is rejected through the store", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    // conclude() 路径：域转移表拒绝（defined -/-> concluded）。
    expect(() =>
      store.conclude(TENANT, "exp-1", concludeInput(), { now: CONCLUDED_AT }),
    ).toThrow(ExperimentTransitionError);
    // applyTransition 路径：concluded 不是合法转移形态（收尾只能经 conclude() 表达），
    // 契约校验层即拒绝——同样 fail-closed，只是错误类型不同。
    expect(() =>
      store.applyTransition(
        TENANT,
        "exp-1",
        { target: "concluded" } as never,
        { now: CONCLUDED_AT },
      ),
    ).toThrow(ExperimentValidationError);
    expect(store.getExperiment(TENANT, "exp-1")?.status).toBe("defined");
  });

  test("outcome without evidence is unwritable at the store level (invariant §21 fail-closed)", () => {
    const dir = newDir();
    // 直接落一个 schema 合法但违反不变量 §21 的记录（outcome 非 null 而 status 非 concluded）。
    const corrupt = handBuiltExperiment({
      id: "exp-corrupt",
      status: "analyzed",
      outcome: "succeeded",
      measurement_evidence_refs: [],
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({ version: 1, experiments: [corrupt] }),
      "utf8",
    );
    const store = newStore(dir);

    // 任何写路径都无法推进该记录（落盘守卫 fail-closed）。
    expect(() =>
      store.applyTransition(TENANT, "exp-corrupt", { target: "cancelled" }, { now: T3 }),
    ).toThrow(InvariantViolation);
    expect(store.getExperiment(TENANT, "exp-corrupt")?.status).toBe("analyzed");
  });

  test("skipping states through the store is rejected", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    expect(() =>
      store.applyTransition(TENANT, "exp-1", { target: "analyzed" }, { now: T3 }),
    ).toThrow(ExperimentTransitionError);
    expect(store.getExperiment(TENANT, "exp-1")?.status).toBe("defined");
  });

  test("assigned without an assignment record is rejected by the input schema", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    expect(() =>
      store.applyTransition(
        TENANT,
        "exp-1",
        { target: "assigned" } as never,
        { now: T2 },
      ),
    ).toThrow(ExperimentValidationError);
  });
});

describe("ExperimentStore.linkHypothesis (adoption-side durable link)", () => {
  test("links hypothesis_id idempotently without touching other fields", () => {
    const dir = newDir();
    const store = newStore(dir);
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    const linked = store.linkHypothesis(TENANT, "exp-1", "hyp-1", { now: T2 });
    expect(linked.hypothesis_id).toBe("hyp-1");

    const again = store.linkHypothesis(TENANT, "exp-1", "hyp-1", { now: T3 });
    expect(again).toEqual(linked); // 幂等直返：不改时间戳

    const reloaded = newStore(dir).getExperiment(TENANT, "exp-1");
    expect(reloaded?.hypothesis_id).toBe("hyp-1");
    expect(reloaded?.statement).toBe(linked.statement); // 只写链接字段，其余不动
  });

  test("relinking to a different hypothesis fails closed", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    store.linkHypothesis(TENANT, "exp-1", "hyp-1", { now: T2 });
    const error = (() => {
      try {
        store.linkHypothesis(TENANT, "exp-1", "hyp-2", { now: T3 });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(HypothesisAdoptionError);
    expect((error as HypothesisAdoptionError).reason).toBe("experiment_hypothesis_conflict");
    expect(store.getExperiment(TENANT, "exp-1")?.hypothesis_id).toBe("hyp-1");
  });
});

describe("ExperimentStore reads and tenant isolation", () => {
  test("getExperiment: unknown id → null; another tenant's record → InvariantViolation", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    expect(store.getExperiment(TENANT, "exp-missing")).toBeNull();
    expect(() => store.getExperiment(OTHER_TENANT, "exp-1")).toThrow(InvariantViolation);
  });

  test("mutations on an unknown id fail closed with ExperimentNotFoundError", () => {
    const store = newStore(newDir());
    expect(() =>
      store.applyTransition(TENANT, "exp-missing", { target: "cancelled" }, { now: T3 }),
    ).toThrow(ExperimentNotFoundError);
    expect(() =>
      store.conclude(TENANT, "exp-missing", concludeInput(), { now: CONCLUDED_AT }),
    ).toThrow(ExperimentNotFoundError);
    expect(() =>
      store.linkHypothesis(TENANT, "exp-missing", "hyp-1", { now: T3 }),
    ).toThrow(ExperimentNotFoundError);
  });

  test("cross-tenant mutations fail closed (record exists but belongs to another tenant)", () => {
    const store = newStore(newDir());
    store.define(OTHER_TENANT, baseInput({ tenant_id: OTHER_TENANT }), { now: T1, id: "exp-globex-1" });
    expect(() =>
      store.applyTransition(
        TENANT,
        "exp-globex-1",
        { target: "assigned", assignment: ASSIGNMENT_RECORD },
        { now: T2 },
      ),
    ).toThrow(InvariantViolation);
    expect(() =>
      store.conclude(TENANT, "exp-globex-1", concludeInput(), { now: CONCLUDED_AT }),
    ).toThrow(InvariantViolation);
    expect(() =>
      store.linkHypothesis(TENANT, "exp-globex-1", "hyp-1", { now: T3 }),
    ).toThrow(InvariantViolation);
  });

  test("listExperimentsByMission filters by mission and tenant; null-mission never matches", () => {
    const store = newStore(newDir());
    store.define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    store.define(TENANT, baseInput({ mission_id: OTHER_MISSION_ID }), { now: T1, id: "exp-2" });
    store.define(TENANT, baseInput({ mission_id: null }), { now: T1, id: "exp-3" });
    store.define(OTHER_TENANT, baseInput({ tenant_id: OTHER_TENANT }), { now: T1, id: "exp-globex-1" });

    expect(
      store.listExperimentsByMission(TENANT, MISSION_ID).map((experiment) => experiment.id),
    ).toEqual(["exp-1"]);
    expect(store.listExperimentsByMission(TENANT, "mos-mission-none")).toEqual([]);
    expect(store.listExperimentsByTenant(TENANT).length).toBe(3);
    expect(store.listExperimentsByTenant(OTHER_TENANT).map((e) => e.id)).toEqual([
      "exp-globex-1",
    ]);
  });
});

describe("durability and corruption (fail-closed)", () => {
  test("atomic write leaves no tmp residue and the store file is the expected name", () => {
    const dir = newDir();
    newStore(dir).define(TENANT, baseInput(), { now: T1, id: "exp-1" });
    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);
  });

  test("corrupted store files fail closed (invalid JSON, wrong structure, schema violation)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).listExperimentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_FILE),
      JSON.stringify({ version: 1, experiments: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listExperimentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );

    const schemaCorrupt = newDir();
    mkdirSync(schemaCorrupt, { recursive: true });
    writeFileSync(
      join(schemaCorrupt, STORE_FILE),
      JSON.stringify({ version: 1, experiments: [baseExperiment({ statement: "" })] }),
      "utf8",
    );
    expect(() => newStore(schemaCorrupt).listExperimentsByTenant(TENANT)).toThrow(
      ContractValidationError,
    );
  });

  test("a missing store file starts empty (no error)", () => {
    const store = newStore(newDir());
    expect(store.listExperimentsByTenant(TENANT)).toEqual([]);
    expect(store.getExperiment(TENANT, "exp-1")).toBeNull();
  });
});
