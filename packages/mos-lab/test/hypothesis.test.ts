import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  hypothesisFromProposal,
  HypothesisStore,
  MissionNotFoundError,
} from "../src/index.js";
import type { MissionLookup } from "../src/index.js";
import {
  baseHypothesis,
  baseMission,
  baseProposal,
  EVIDENCE_REF,
  MISSION_ID,
  OTHER_TENANT,
  STORE_HYPOTHESES_FILE,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

/**
 * Hypothesis 矩阵：提案 happy path（决策锁 #18：proposed / experiment_ref null）、
 * mission 门禁（MissionNotFoundError）、lab 写边界永不携带实验结果、tenant 隔离与持久化。
 */

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-lab-hypotheses-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** missionLookup 端口的内存 fake：按 (tenant, mission) 解析（他租户 mission = 不存在）。 */
function missionLookupOf(...missions: ReturnType<typeof baseMission>[]): MissionLookup {
  return (tenantId, missionId) => {
    const found = missions.find((mission) => mission.id === missionId);
    if (found === undefined) return undefined;
    return found.tenant_id === tenantId ? found : undefined;
  };
}

function newStore(dir: string, lookup: MissionLookup = missionLookupOf(baseMission())) {
  return new HypothesisStore({ directory: dir, missionLookup: lookup });
}

describe("hypothesisFromProposal (decision lock #18: no outcome vocabulary at creation)", () => {
  test("forces status=proposed and experiment_ref=null; copies fields verbatim", () => {
    const hypothesis = hypothesisFromProposal(
      baseProposal({
        statement: "Pricing clarity increases qualified inbound leads.",
        rationale: "Research findings mention pricing uncertainty.",
        evidence_refs: [EVIDENCE_REF],
        proposed_route_ids: ["route:mos-mission-fixture:1:1"],
      }),
      { now: T1, id: "hyp-new" },
    );
    expect(hypothesis.status).toBe("proposed");
    expect(hypothesis.experiment_ref).toBeNull();
    expect(hypothesis.statement).toBe("Pricing clarity increases qualified inbound leads.");
    expect(hypothesis.rationale).toBe("Research findings mention pricing uncertainty.");
    expect(hypothesis.evidence_refs).toEqual([EVIDENCE_REF]);
    expect(hypothesis.proposed_route_ids).toEqual(["route:mos-mission-fixture:1:1"]);
    expect(hypothesis.created_at).toBe(T1);
    expect(hypothesis.updated_at).toBe(T1);
  });

  test("absent optional fields stay null/[] (rationale null, refs empty)", () => {
    const hypothesis = hypothesisFromProposal(
      baseProposal({ rationale: null, evidence_refs: [], proposed_route_ids: [] }),
      { now: T1, id: "hyp-min" },
    );
    expect(hypothesis.rationale).toBeNull();
    expect(hypothesis.evidence_refs).toEqual([]);
    expect(hypothesis.proposed_route_ids).toEqual([]);
  });
});

describe("HypothesisStore.proposeHypothesis (mission-gated, outcome-free)", () => {
  test("happy path persists a proposed hypothesis with experiment_ref null", () => {
    const store = newStore(newDir());
    const saved = store.proposeHypothesis(
      TENANT,
      baseProposal({ statement: "Publishing pricing pages increases leads." }),
      { now: T1, id: "hyp-1" },
    );
    expect(saved.status).toBe("proposed");
    expect(saved.experiment_ref).toBeNull();
    expect(saved.mission_id).toBe(MISSION_ID);

    const loaded = store.getHypothesis(TENANT, "hyp-1");
    expect(loaded).toEqual(saved);
    expect(loaded?.status).toBe("proposed");
    expect(loaded?.experiment_ref).toBeNull();
  });

  test("unknown mission fails closed with MissionNotFoundError", () => {
    const store = newStore(newDir(), missionLookupOf());
    expect(() =>
      store.proposeHypothesis(
        TENANT,
        baseProposal({ mission_id: "mos-mission-missing" }),
        { now: T1, id: "hyp-1" },
      ),
    ).toThrow(MissionNotFoundError);
    expect(store.listHypotheses(TENANT)).toEqual([]);
  });

  test("another tenant's mission is indistinguishable from a missing mission (tenant-scoped port)", () => {
    const store = newStore(
      newDir(),
      missionLookupOf(baseMission({ tenant_id: OTHER_TENANT, id: "mos-mission-globex" })),
    );
    expect(() =>
      store.proposeHypothesis(
        TENANT,
        baseProposal({ mission_id: "mos-mission-globex" }),
        { now: T1, id: "hyp-1" },
      ),
    ).toThrow(MissionNotFoundError);
  });

  test("a broken port returning another tenant's mission fails closed with InvariantViolation", () => {
    const foreign = baseMission({ tenant_id: OTHER_TENANT, id: MISSION_ID });
    const brokenPort: MissionLookup = (_tenantId, missionId) =>
      missionId === MISSION_ID ? foreign : undefined;
    const store = newStore(newDir(), brokenPort);
    expect(() =>
      store.proposeHypothesis(TENANT, baseProposal(), { now: T1, id: "hyp-1" }),
    ).toThrow(InvariantViolation);
  });

  test("proposal tenant mismatch with the caller fails closed with InvariantViolation", () => {
    // 端口按调用方租户解析 mission（合法端口形态）；记录租户与调用方不一致 → fail-closed。
    const callerScopedPort: MissionLookup = (tenantId, missionId) =>
      missionId === MISSION_ID ? baseMission({ tenant_id: tenantId }) : undefined;
    const store = newStore(newDir(), callerScopedPort);
    expect(() =>
      store.proposeHypothesis(
        OTHER_TENANT,
        baseProposal({ tenant_id: TENANT }),
        { now: T1, id: "hyp-1" },
      ),
    ).toThrow(InvariantViolation);
    expect(store.listHypotheses(TENANT)).toEqual([]);
  });
});

describe("HypothesisStore write boundary (decision lock #18: no outcome can ever be created here)", () => {
  test("saveHypothesis rejects adopted_by_experiment even with an experiment_ref (lab owns no outcomes)", () => {
    const store = newStore(newDir());
    const adopted = baseHypothesis({
      status: "adopted_by_experiment",
      experiment_ref: "experiment:exp-1",
    });
    expect(() => store.saveHypothesis(TENANT, adopted)).toThrow(InvariantViolation);
    expect(store.listHypotheses(TENANT)).toEqual([]);
  });

  test("saveHypothesis rejects experiment_ref with a non-adopted status (contract invariant §15)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.saveHypothesis(TENANT, baseHypothesis({ experiment_ref: "experiment:exp-1" })),
    ).toThrow(InvariantViolation);
  });

  test("saveHypothesis rejects adopted_by_experiment without an experiment_ref (contract invariant §15)", () => {
    const store = newStore(newDir());
    expect(() =>
      store.saveHypothesis(
        TENANT,
        baseHypothesis({ status: "adopted_by_experiment", experiment_ref: null }),
      ),
    ).toThrow(InvariantViolation);
  });

  test("saveHypothesis accepts lifecycle updates within the lab-writable vocabulary (superseded/withdrawn)", () => {
    const store = newStore(newDir());
    store.proposeHypothesis(TENANT, baseProposal(), { now: T1, id: "hyp-1" });

    const superseded = store.saveHypothesis(
      TENANT,
      baseHypothesis({ id: "hyp-1", status: "superseded", updated_at: T2 }),
    );
    expect(superseded.status).toBe("superseded");
    expect(superseded.experiment_ref).toBeNull();

    const withdrawn = store.saveHypothesis(
      TENANT,
      baseHypothesis({ id: "hyp-1", status: "withdrawn", updated_at: T2 }),
    );
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.experiment_ref).toBeNull();
  });

  test("saveHypothesis also requires the mission to exist (fail-closed on unknown mission)", () => {
    const store = newStore(newDir(), missionLookupOf());
    expect(() =>
      store.saveHypothesis(
        TENANT,
        baseHypothesis({ mission_id: "mos-mission-missing" }),
      ),
    ).toThrow(MissionNotFoundError);
  });

  test("schema-invalid hypothesis fails closed with ContractValidationError", () => {
    const store = newStore(newDir());
    expect(() => store.saveHypothesis(TENANT, baseHypothesis({ statement: "" }))).toThrow(
      ContractValidationError,
    );
  });
});

describe("HypothesisStore reads (tenant-scoped, durable)", () => {
  test("getHypothesis: unknown id → null; cross-tenant record → InvariantViolation", () => {
    const store = newStore(newDir());
    store.proposeHypothesis(TENANT, baseProposal(), { now: T1, id: "hyp-1" });
    expect(store.getHypothesis(TENANT, "hyp-missing")).toBeNull();
    expect(() => store.getHypothesis(OTHER_TENANT, "hyp-1")).toThrow(InvariantViolation);
  });

  test("listHypothesesByMission filters by mission and tenant", () => {
    const store = newStore(
      newDir(),
      missionLookupOf(baseMission(), baseMission({ id: "mos-mission-other" })),
    );
    store.proposeHypothesis(TENANT, baseProposal(), { now: T1, id: "hyp-1" });
    store.proposeHypothesis(
      TENANT,
      baseProposal({ mission_id: "mos-mission-other" }),
      { now: T1, id: "hyp-2" },
    );
    expect(store.listHypothesesByMission(TENANT, MISSION_ID).map((h) => h.id)).toEqual([
      "hyp-1",
    ]);
    expect(store.listHypothesesByMission(TENANT, "mos-mission-other").map((h) => h.id)).toEqual([
      "hyp-2",
    ]);
    expect(store.listHypothesesByMission(OTHER_TENANT, MISSION_ID)).toEqual([]);
  });

  test("durability: a new store instance reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    newStore(dir).proposeHypothesis(TENANT, baseProposal(), { now: T1, id: "hyp-1" });
    expect(existsSync(join(dir, STORE_HYPOTHESES_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_HYPOTHESES_FILE]);

    const reloaded = newStore(dir).getHypothesis(TENANT, "hyp-1");
    expect(reloaded?.status).toBe("proposed");
    expect(reloaded?.experiment_ref).toBeNull();
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_HYPOTHESES_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).listHypotheses(TENANT)).toThrow(ContractValidationError);

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_HYPOTHESES_FILE),
      JSON.stringify({ version: 1, hypotheses: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listHypotheses(TENANT)).toThrow(ContractValidationError);
  });
});
