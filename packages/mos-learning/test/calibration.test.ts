import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { ExperimentLookup } from "../src/index.js";
import {
  CalibrationSourceError,
  CalibrationStore,
} from "../src/index.js";
import { ContractValidationError } from "@mos/contracts";
import type { CalibrationIntake } from "../src/index.js";

/**
 * mos-learning 契约测试：
 * - 来源门禁三拒绝（experiment_not_found / not_concluded / no_measurement_evidence）；
 * - delayed_mode 恒 true（调用方不可表达 false——intake 形状里根本没有该字段）；
 * - tenant 隔离 + 持久化 + 损坏 fail-closed。
 */

const TENANT = "tenant-acme";
const OTHER = "tenant-globex";
const T1 = "2026-11-13T12:00:00Z";
const EXP = "exp-1";

/** 同步临时目录夹具（W2/W3 store 测试同模式；测试内不跨 await）。 */
function newDir(): string {
  const dir = join(
    tmpdir(),
    `mos-learning-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const concludedExperiment: ExperimentLookup = (_tenant, ref) =>
  ref === EXP
    ? {
        status: "concluded",
        outcome: "succeeded",
        measurement_evidence_refs: ["ev-measure-1", "ev-measure-2"],
      }
    : undefined;

function baseIntake(overrides: Partial<CalibrationIntake> = {}): CalibrationIntake {
  return {
    tenant_id: TENANT,
    experiment_ref: EXP,
    calibration: { lift: 0.12, confidence: 0.8 },
    recommendation: "keep pricing page variant",
    evidence_refs: [],
    ...overrides,
  };
}

function newStore(
  dir: string,
  lookup: ExperimentLookup = concludedExperiment,
): CalibrationStore {
  return new CalibrationStore({ directory: dir, experimentLookup: lookup });
}

describe("calibration source gate (invariant fail-closed)", () => {
  test("concluded experiment with measurement evidence passes", () => {
    const store = newStore(newDir());
    const record = store.record(TENANT, baseIntake(), { now: T1, id: "cal-1" });
    expect(record.delayed_mode).toBe(true);
    expect(record.experiment_ref).toBe(EXP);
  });

  test("unknown experiment rejects with experiment_not_found", () => {
    const store = newStore(newDir());
    try {
      store.record(TENANT, baseIntake({ experiment_ref: "exp-missing" }), {
        now: T1,
        id: "cal-1",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CalibrationSourceError);
      expect((error as CalibrationSourceError).reason).toBe("experiment_not_found");
    }
  });

  test("non-concluded experiment rejects with not_concluded", () => {
    const lookup: ExperimentLookup = (_t, ref) =>
      ref === EXP
        ? { status: "measuring", outcome: null, measurement_evidence_refs: ["ev-1"] }
        : undefined;
    const store = newStore(newDir(), lookup);
    expect(() => store.record(TENANT, baseIntake(), { now: T1, id: "cal-1" })).toThrow(
      /not_concluded/,
    );
  });

  test("concluded without evidence rejects with no_measurement_evidence", () => {
    const lookup: ExperimentLookup = (_t, ref) =>
      ref === EXP
        ? { status: "concluded", outcome: "inconclusive", measurement_evidence_refs: [] }
        : undefined;
    const store = newStore(newDir(), lookup);
    expect(() => store.record(TENANT, baseIntake(), { now: T1, id: "cal-1" })).toThrow(
      /no_measurement_evidence/,
    );
  });

  test("tenant mismatch between caller and intake fails closed", () => {
    const store = newStore(newDir());
    expect(() =>
      store.record(OTHER, baseIntake({ tenant_id: TENANT }), { now: T1, id: "cal-1" }),
    ).toThrow(/tenant 不一致/);
  });
});

describe("delayed-mode safeguard (recommendation records only)", () => {
  test("records are always delayed_mode=true", () => {
    const store = newStore(newDir());
    for (let i = 0; i < 3; i++) {
      const record = store.record(TENANT, baseIntake(), { now: T1, id: `cal-${i}` });
      expect(record.delayed_mode).toBe(true);
    }
  });

  test("the package surface exposes no route/production mutation API", async () => {
    const moduleExports = await import("../src/index.js");
    const exportedNames = Object.keys(moduleExports);
    const mutating = exportedNames.filter((name) =>
      /apply|execute|mutate|update|transition|run|start/i.test(name),
    );
    // 零执行/零修改 API（delayed-mode：只有记录与读取）。
    expect(mutating).toEqual([]);
  });

  test("calibration ids are not reusable (append-only)", () => {
    const dir = newDir();
    const store = newStore(dir);
    store.record(TENANT, baseIntake(), { now: T1, id: "cal-same" });
    expect(() =>
      store.record(TENANT, baseIntake(), { now: T1, id: "cal-same" }),
    ).toThrow(/id 已存在/);
  });
});

describe("CalibrationStore persistence (tenant-scoped, atomic, fail-closed)", () => {
  test("listByTenant / listByExperiment scope to the caller tenant", () => {
    const dir = newDir();
    const store = newStore(dir);
    store.record(TENANT, baseIntake(), { now: T1, id: "cal-a" });
    store.record(
      OTHER,
      baseIntake({ tenant_id: OTHER }),
      { now: T1, id: "cal-b" },
    );
    expect(store.listByTenant(TENANT).map((r) => r.id)).toEqual(["cal-a"]);
    expect(store.listByTenant(OTHER).map((r) => r.id)).toEqual(["cal-b"]);
    expect(store.listByExperiment(TENANT, EXP).map((r) => r.id)).toEqual(["cal-a"]);
    // OTHER 租户自己的 cal-b 也挂在 EXP 下——按租户过滤后对 OTHER 可见（租户隔离，
    // 不是实验隔离）。
    expect(store.listByExperiment(OTHER, EXP).map((r) => r.id)).toEqual(["cal-b"]);
  });

  test("durability: a new store instance reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    newStore(dir).record(TENANT, baseIntake(), { now: T1, id: "cal-1" });
    expect(existsSync(join(dir, "mos-calibrations.json"))).toBe(true);
    expect(readdirSync(dir)).toEqual(["mos-calibrations.json"]);
    const reloaded = newStore(dir).listByTenant(TENANT);
    expect(reloaded.map((r) => r.id)).toEqual(["cal-1"]);
    expect(reloaded[0]?.delayed_mode).toBe(true);
  });

  test("corrupted store file fails closed", () => {
    const dir = newDir();
    newStore(dir).record(TENANT, baseIntake(), { now: T1, id: "cal-1" });
    writeFileSync(join(dir, "mos-calibrations.json"), "{ not json", "utf8");
    expect(() => newStore(dir).listByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("record with wrong root structure fails closed", () => {
    const dir = newDir();
    newStore(dir).record(TENANT, baseIntake(), { now: T1, id: "cal-1" });
    writeFileSync(join(dir, "mos-calibrations.json"), JSON.stringify([1, 2]), "utf8");
    expect(() => newStore(dir).listByTenant(TENANT)).toThrow(/结构/);
  });
});

describe("intake validation", () => {
  test("empty experiment_ref rejects at schema level", () => {
    const store = newStore(newDir());
    expect(() =>
      store.record(TENANT, baseIntake({ experiment_ref: "" }), { now: T1, id: "cal-1" }),
    ).toThrow();
  });

  test("calibration record content round-trips verbatim", () => {
    const store = newStore(newDir());
    const record = store.record(
      TENANT,
      baseIntake({ calibration: { lift: 0.12, confidence: 0.8 } }),
      { now: T1, id: "cal-1" },
    );
    expect(record.calibration).toEqual({ lift: 0.12, confidence: 0.8 });
    expect(record.recommendation).toBe("keep pricing page variant");
  });
});
