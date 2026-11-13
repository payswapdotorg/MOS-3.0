import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  ResearchNoteStore,
  researchNoteFromIntake,
} from "../src/index.js";
import {
  baseIntake,
  baseNote,
  EVIDENCE_REF,
  evidenceLookup,
  MISSION_ID,
  OTHER_TENANT,
  STORE_NOTES_FILE,
  T1,
  TENANT,
} from "./fixtures.js";

/**
 * ResearchNote 矩阵：逐字 intake round-trip、evidence 门禁（不变量 §16）、
 * tenant 隔离（跨租户显式拒绝）、durable 持久化与损坏 fail-closed。
 */

const dirs: string[] = [];
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mos-lab-notes-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newStore(dir: string): ResearchNoteStore {
  return new ResearchNoteStore({ directory: dir, evidenceLookup });
}

describe("researchNoteFromIntake (verbatim, zero inference)", () => {
  test("round-trips the topic/insight/findings verbatim (spacing, case and punctuation preserved)", () => {
    const intake = baseIntake({
      topic: "  Organic Search   intent gaps  ",
      insight: "Pricing clarity may be the bottleneck.  ",
      findings: [
        {
          evidence_ref: EVIDENCE_REF,
          statement: "Contact-form submissions mention pricing 3x more than demos.",
        },
      ],
    });
    const note = researchNoteFromIntake(intake, { now: T1, id: "note-verbatim" });
    expect(note.topic).toBe("  Organic Search   intent gaps  ");
    expect(note.insight).toBe("Pricing clarity may be the bottleneck.  ");
    expect(note.findings).toEqual([
      {
        evidence_ref: EVIDENCE_REF,
        statement: "Contact-form submissions mention pricing 3x more than demos.",
      },
    ]);
    expect(note.created_at).toBe(T1);
    expect(note.updated_at).toBe(T1);
  });

  test("absent fields stay null/[] (never inferred)", () => {
    const note = researchNoteFromIntake(baseIntake({ mission_id: null }), { now: T1, id: "note-min" });
    expect(note.mission_id).toBeNull();
    expect(note.insight).toBeNull();
    expect(note.confidence).toBeNull();
    expect(note.findings).toEqual([]);
    expect(note.limitations).toEqual([]);
  });

  test("invalid intake fails closed with ContractValidationError", () => {
    expect(() =>
      researchNoteFromIntake(baseIntake({ topic: "" }), { now: T1, id: "note-bad" }),
    ).toThrow(ContractValidationError);
    expect(() =>
      researchNoteFromIntake(
        baseIntake({ findings: [{ evidence_ref: "", statement: "x" }] }),
        { now: T1, id: "note-bad" },
      ),
    ).toThrow(ContractValidationError);
  });
});

describe("ResearchNoteStore (durable, tenant-scoped, evidence-gated)", () => {
  test("save/get round-trips a schema-valid note verbatim through the file backend", () => {
    const store = newStore(newDir());
    const saved = store.saveNote(TENANT, baseNote());
    expect(saved.id).toBe("note-1");
    const loaded = store.getNote(TENANT, "note-1");
    expect(loaded).toEqual(baseNote());
    expect(loaded?.topic).toBe("Inbound lead intent gaps");
    expect(loaded?.mission_id).toBe(MISSION_ID);
  });

  test("rejects a finding whose evidence ref does not exist (invariant §16, fail-closed)", () => {
    const store = newStore(newDir());
    const note = baseNote(
      {},
      {
        findings: [
          { evidence_ref: "evidence:missing-ref", statement: "Something unverified." },
        ],
      },
    );
    expect(() => store.saveNote(TENANT, note)).toThrow(InvariantViolation);
    expect(() => store.saveNote(TENANT, note)).toThrow(/evidence:missing-ref/);
    // 整条 note 不落盘。
    expect(store.listNotes(TENANT)).toEqual([]);
  });

  test("rejects simulation-kind evidence as provider observation (invariant §16)", () => {
    const store = newStore(newDir());
    const note = baseNote(
      {},
      {
        findings: [
          { evidence_ref: "evidence:model-forecast", statement: "Forecast says demand will double." },
        ],
      },
    );
    expect(() => store.saveNote(TENANT, note)).toThrow(InvariantViolation);
    expect(() => store.saveNote(TENANT, note)).toThrow(/simulation/);
    expect(store.listNotes(TENANT)).toEqual([]);
  });

  test("accepts non-simulation evidence kinds (provider_response / analytics_event / human_review)", () => {
    const store = newStore(newDir());
    const note = baseNote(
      {},
      {
        findings: [
          { evidence_ref: EVIDENCE_REF, statement: "Provider observation." },
          { evidence_ref: "evidence:web-analytics-week-46", statement: "Analytics observation." },
          { evidence_ref: "evidence:panel-notes", statement: "Human review observation." },
        ],
      },
    );
    const saved = store.saveNote(TENANT, note);
    expect(saved.findings).toHaveLength(3);
  });

  test("a finding without an evidence ref cannot even be constructed (contract shape gate)", () => {
    expect(() =>
      researchNoteFromIntake(
        baseIntake({ findings: [{ statement: "no ref" } as never] }),
        { now: T1, id: "note-shape" },
      ),
    ).toThrow(ContractValidationError);
  });

  test("durability: a new store instance on the same directory reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    newStore(dir).saveNote(TENANT, baseNote());
    expect(existsSync(join(dir, STORE_NOTES_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_NOTES_FILE]);

    const reloaded = newStore(dir).getNote(TENANT, "note-1");
    expect(reloaded?.id).toBe("note-1");
    expect(reloaded?.topic).toBe("Inbound lead intent gaps");
  });

  test("re-saving an existing id updates in place within the tenant", () => {
    const store = newStore(newDir());
    store.saveNote(TENANT, baseNote());
    store.saveNote(
      TENANT,
      researchNoteFromIntake(baseIntake({ topic: "Updated topic." }), { now: T1, id: "note-1" }),
    );
    expect(store.getNote(TENANT, "note-1")?.topic).toBe("Updated topic.");
    expect(store.listNotes(TENANT)).toHaveLength(1);
  });

  test("cross-tenant save fails closed with InvariantViolation (assertTenantScope)", () => {
    const store = newStore(newDir());
    expect(() => store.saveNote(OTHER_TENANT, baseNote())).toThrow(InvariantViolation);
    expect(store.listNotes(TENANT)).toEqual([]);
  });

  test("cross-tenant get fails closed with InvariantViolation (explicit rejection, not silent null)", () => {
    const store = newStore(newDir());
    store.saveNote(TENANT, baseNote());
    expect(() => store.getNote(OTHER_TENANT, "note-1")).toThrow(InvariantViolation);
  });

  test("unknown note id returns null", () => {
    const store = newStore(newDir());
    expect(store.getNote(TENANT, "note-missing")).toBeNull();
  });

  test("listNotes only returns the caller tenant's notes", () => {
    const store = newStore(newDir());
    store.saveNote(TENANT, baseNote());
    store.saveNote(
      OTHER_TENANT,
      baseNote(
        { id: "note-globex", tenant_id: OTHER_TENANT },
        { tenant_id: OTHER_TENANT },
      ),
    );
    expect(store.listNotes(TENANT).map((note) => note.id)).toEqual(["note-1"]);
    expect(store.listNotes(OTHER_TENANT).map((note) => note.id)).toEqual(["note-globex"]);
  });

  test("listNotesByMission filters by mission and tenant; null-mission notes never match", () => {
    const store = newStore(newDir());
    store.saveNote(TENANT, baseNote({}, { mission_id: MISSION_ID }));
    store.saveNote(
      TENANT,
      researchNoteFromIntake(baseIntake({ mission_id: null, topic: "Unlinked research." }), {
        now: T1,
        id: "note-unlinked",
      }),
    );
    store.saveNote(
      TENANT,
      researchNoteFromIntake(baseIntake({ mission_id: "mos-mission-other", topic: "Other mission." }), {
        now: T1,
        id: "note-other-mission",
      }),
    );
    expect(store.listNotesByMission(TENANT, MISSION_ID).map((note) => note.id)).toEqual([
      "note-1",
    ]);
    expect(store.listNotesByMission(TENANT, "mos-mission-other").map((note) => note.id)).toEqual([
      "note-other-mission",
    ]);
    expect(store.listNotesByMission(OTHER_TENANT, MISSION_ID)).toEqual([]);
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_NOTES_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).listNotes(TENANT)).toThrow(ContractValidationError);

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(
      join(wrongShape, STORE_NOTES_FILE),
      JSON.stringify({ version: 1, notes: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listNotes(TENANT)).toThrow(ContractValidationError);
  });

  test("schema-invalid note fails closed with ContractValidationError at the write boundary", () => {
    const store = newStore(newDir());
    expect(() =>
      store.saveNote(TENANT, baseNote({ topic: "" })),
    ).toThrow(ContractValidationError);
  });
});
