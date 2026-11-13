import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import { assertMarketIntelligenceEvidenced } from "@mos/contracts";
import {
  MarketIntelligenceStore,
  MarketIntelligenceValidationError,
  marketIntelligenceFromInput,
} from "../src/index.js";
import {
  createdIntelligence,
  intelligenceIntake,
  OTHER_TENANT,
  STORE_FILE_INTEL,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

const directories: string[] = [];

function makeStore(): { store: MarketIntelligenceStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "mos-commerce-intel-test-"));
  directories.push(directory);
  return { store: new MarketIntelligenceStore({ directory }), directory };
}

describe("marketIntelligenceFromInput (§25 evidence gate at materialization)", () => {
  test("materializes an evidenced record with opaque subject ref", () => {
    const record = marketIntelligenceFromInput(intelligenceIntake(), { id: "intel-1", now: T1 });
    expect(record.subject_ref).toBe("segment-smb-gh");
    expect(record.evidence_refs).toEqual(["ev-intel-1"]);
    expect(record.facts).toEqual({ median_acceptable_price_usd: "149.00" });
  });

  test("unevidenced intake fails closed at the schema boundary (min 1 evidence ref)", () => {
    expect(() =>
      marketIntelligenceFromInput(intelligenceIntake({ evidence_refs: [] }), {
        id: "intel-1",
        now: T1,
      }),
    ).toThrow(ContractValidationError);
    expect(() =>
      marketIntelligenceFromInput(intelligenceIntake({ topic: "" }), { id: "intel-1", now: T1 }),
    ).toThrow(ContractValidationError);
  });

  test("hand-built unevidenced record is rejected by the §25 guard (defense in depth)", () => {
    // §25 终守卫（assertMarketIntelligenceEvidenced）在领域物化与 store 落盘前都会再跑；
    // 这里直接验证守卫对绕过 intake 的手工记录拒绝（守卫本体在 @mos/contracts 已全测）。
    const handBuilt = { ...createdIntelligence(), evidence_refs: [] };
    expect(() => assertMarketIntelligenceEvidenced(handBuilt)).toThrow(InvariantViolation);
  });

  test("facts are carried verbatim — zero inference, no invented keys", () => {
    const facts = { median_acceptable_price_usd: "149.00", sample_size: "40" };
    const record = marketIntelligenceFromInput(intelligenceIntake({ facts }), {
      id: "intel-1",
      now: T1,
    });
    expect(record.facts).toEqual(facts);
    expect(Object.keys(record.facts).sort()).toEqual(["median_acceptable_price_usd", "sample_size"]);
  });
});

describe("MarketIntelligenceStore (durable, tenant-scoped, §25 gated)", () => {
  test("creates evidenced records and persists them across restarts", () => {
    const { store, directory } = makeStore();
    store.createRecord(TENANT, intelligenceIntake(), { id: "intel-1", now: T1 });

    const reopened = new MarketIntelligenceStore({ directory });
    const reread = reopened.getRecord(TENANT, "intel-1");
    expect(reread?.topic).toBe("segment price sensitivity");
    expect(reread?.insight).toBe("SMB segment tolerates up to 149 USD/mo");
  });

  test("unevidenced intake fails closed with typed error and nothing persisted", () => {
    const { store } = makeStore();
    expect(() =>
      store.createRecord(TENANT, intelligenceIntake({ evidence_refs: [] }), {
        id: "intel-1",
        now: T1,
      }),
    ).toThrow(MarketIntelligenceValidationError);
    expect(store.listRecordsByTenant(TENANT)).toHaveLength(0);
  });

  test("subject-scoped listing stays inside the caller tenant", () => {
    const { store } = makeStore();
    store.createRecord(TENANT, intelligenceIntake(), { id: "intel-1", now: T1 });
    store.createRecord(
      OTHER_TENANT,
      intelligenceIntake({ tenant_id: OTHER_TENANT, subject_ref: "segment-smb-gh" }),
      { id: "intel-2", now: T1 },
    );
    expect(store.listRecordsBySubject(TENANT, "segment-smb-gh")).toHaveLength(1);
    expect(store.listRecordsBySubject(OTHER_TENANT, "segment-smb-gh")).toHaveLength(1);
    expect(() => store.getRecord(TENANT, "intel-2")).toThrow(InvariantViolation);
    expect(store.getRecord(TENANT, "intel-404")).toBeNull();
  });

  test("cross-tenant write fails closed with InvariantViolation", () => {
    const { store } = makeStore();
    expect(() =>
      store.createRecord(OTHER_TENANT, intelligenceIntake(), { id: "intel-x", now: T2 }),
    ).toThrow(InvariantViolation);
  });

  test("corrupted store file fails closed on read", () => {
    const { store, directory } = makeStore();
    store.createRecord(TENANT, intelligenceIntake(), { id: "intel-1", now: T1 });
    writeFileSync(join(directory, STORE_FILE_INTEL), "not json", "utf8");
    expect(() => store.listRecordsByTenant(TENANT)).toThrow(ContractValidationError);
    writeFileSync(
      join(directory, STORE_FILE_INTEL),
      JSON.stringify({ version: 1, market_intelligence: [createdIntelligence({ topic: "" })] }, null, 2),
      "utf8",
    );
    expect(() => store.getRecord(TENANT, "intel-1")).toThrow(ContractValidationError);
  });
});

describe("cleanup", () => {
  test("removes temp directories", () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    expect(directories.length).toBeGreaterThan(0);
  });
});
