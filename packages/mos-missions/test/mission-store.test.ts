import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractValidationError,
  domainEventSchema,
} from "@mos/contracts";
import type { DomainEvent, Mission } from "@mos/contracts";
import type { TimePort } from "@mos/adapters";
import { MissionStore, missionFromIntake } from "../src/index.js";
import type { MissionIntake } from "../src/index.js";

/**
 * MissionStore 矩阵：文件持久化（durable）、tenant 隔离、可空关联与事件边界。
 */

const T1 = "2026-11-12T00:00:00Z";
const T2 = "2026-11-12T01:00:00Z";
const T3 = "2026-11-12T02:00:00Z";
const STORE_FILE = "mos-missions.json";

/** 可变时钟：验证 updated_at 推进与幂等不写。 */
class MutableTimePort implements TimePort {
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
  const dir = mkdtempSync(join(tmpdir(), "mos-missions-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function intakeFor(tenantId: string, overrides: Partial<MissionIntake> = {}): MissionIntake {
  return {
    tenant_id: tenantId,
    workspace_id: "proj_work_acme",
    objective_verbatim: "Increase qualified inbound leads for our service business.",
    source_zcode_session_id: null,
    source_zcode_task_id: null,
    target_audience: null,
    geography: null,
    desired_outcomes: [],
    success_metrics: [],
    budget: null,
    deadline: null,
    ...overrides,
  };
}

function newMission(tenantId: string, id: string, objective = "Increase qualified inbound leads."): Mission {
  return missionFromIntake(intakeFor(tenantId, { objective_verbatim: objective }), {
    now: T1,
    id,
  });
}

function newStore(dir: string, options: { time?: TimePort } = {}) {
  const events: DomainEvent[] = [];
  const store = new MissionStore({
    directory: dir,
    time: options.time,
    eventSink: (event) => {
      events.push(event);
    },
    newEventId: () => `evt-${events.length + 1}`,
  });
  return { store, events };
}

describe("MissionStore (durable, tenant-scoped, event-emitting)", () => {
  test("missing file starts empty; save/get round-trips a schema-valid mission", () => {
    const { store } = newStore(newDir());
    expect(store.listMissions("tenant-acme")).toEqual([]);

    const saved = store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    expect(saved.id).toBe("m-1");
    const loaded = store.getMission("tenant-acme", "m-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.objective).toBe("Increase qualified inbound leads.");
  });

  test("durability: a new store instance on the same directory reloads records", () => {
    const dir = newDir();
    const first = newStore(dir);
    first.store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    // 原子写：目录里只有最终文件，没有 .tmp 残留。
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = newStore(dir);
    const reloaded = second.store.getMission("tenant-acme", "m-1");
    expect(reloaded?.id).toBe("m-1");
    expect(reloaded?.objective).toBe("Increase qualified inbound leads.");
  });

  test("re-saving an existing id updates in place and emits mission.created only once", () => {
    const { store, events } = newStore(newDir());
    store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    store.saveMission(
      "tenant-acme",
      missionFromIntake(intakeFor("tenant-acme", { objective_verbatim: "Updated objective." }), {
        now: T2,
        id: "m-1",
      }),
    );
    expect(store.getMission("tenant-acme", "m-1")?.objective).toBe("Updated objective.");
    expect(events.filter((event) => event.event_type === "mission.created")).toHaveLength(1);
  });

  test("cross-tenant records are invisible (get and list fail closed to empty)", () => {
    const { store } = newStore(newDir());
    store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    expect(store.getMission("tenant-globex", "m-1")).toBeNull();
    expect(store.listMissions("tenant-globex")).toEqual([]);
  });

  test("saving another tenant's mission fails closed with ContractValidationError", () => {
    const { store } = newStore(newDir());
    expect(() => store.saveMission("tenant-globex", newMission("tenant-acme", "m-1"))).toThrow(
      ContractValidationError,
    );
  });

  test("first save emits a mission.created event bound to the mission aggregate", () => {
    const { store, events } = newStore(newDir());
    store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.event_type).toBe("mission.created");
    expect(event?.aggregate_type).toBe("mission");
    expect(event?.aggregate_id).toBe("m-1");
    expect(event?.tenant_id).toBe("tenant-acme");
  });

  test("every emitted event validates against domainEventSchema", () => {
    const dir = newDir();
    const clock = new MutableTimePort(T1);
    const { store, events } = newStore(dir, { time: clock });
    store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    clock.advance(T2);
    store.linkSession("tenant-acme", "m-1", { sessionId: "sess_demo", taskId: "sess_demo" });
    clock.advance(T3);
    store.linkSession("tenant-acme", "m-1", { sessionId: null, taskId: null });
    for (const event of events) {
      expect(() => domainEventSchema.parse(event)).not.toThrow();
    }
    expect(events.map((event) => event.event_type)).toEqual([
      "mission.created",
      "mission.linked",
      "mission.linked",
    ]);
  });

  test("linkSession sets the nullable association, advances updated_at and emits mission.linked", () => {
    const dir = newDir();
    const clock = new MutableTimePort(T1);
    const { store, events } = newStore(dir, { time: clock });
    const saved = store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));

    clock.advance(T2);
    const linked = store.linkSession("tenant-acme", saved.id, {
      sessionId: "sess_demo",
      taskId: "sess_demo",
    });
    expect(linked?.source_zcode_session_id).toBe("sess_demo");
    expect(linked?.source_zcode_task_id).toBe("sess_demo");
    expect(linked?.created_at).toBe(T1);
    expect(linked?.updated_at).toBe(T2);
    expect(events.filter((event) => event.event_type === "mission.linked")).toHaveLength(1);
  });

  test("linkSession is idempotent: same values → no write, no event, updated_at untouched", () => {
    const dir = newDir();
    const clock = new MutableTimePort(T1);
    const { store, events } = newStore(dir, { time: clock });
    const saved = store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));

    clock.advance(T2);
    store.linkSession("tenant-acme", saved.id, { sessionId: "sess_demo", taskId: "sess_demo" });
    const linkedCount = events.filter((event) => event.event_type === "mission.linked").length;

    clock.advance(T3);
    const again = store.linkSession("tenant-acme", saved.id, {
      sessionId: "sess_demo",
      taskId: "sess_demo",
    });
    expect(again?.updated_at).toBe(T2);
    expect(events.filter((event) => event.event_type === "mission.linked")).toHaveLength(linkedCount);
  });

  test("linkSession can clear the association back to null (nullable association)", () => {
    const { store, events } = newStore(newDir());
    const saved = store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    store.linkSession("tenant-acme", saved.id, { sessionId: "sess_demo", taskId: "sess_demo" });

    const cleared = store.linkSession("tenant-acme", saved.id, {
      sessionId: null,
      taskId: null,
    });
    expect(cleared?.source_zcode_session_id).toBeNull();
    expect(cleared?.source_zcode_task_id).toBeNull();
    expect(events.filter((event) => event.event_type === "mission.linked")).toHaveLength(2);
  });

  test("linkSession on an unknown mission returns null (no write, no event)", () => {
    const { store, events } = newStore(newDir());
    expect(store.linkSession("tenant-acme", "m-missing", { sessionId: "s", taskId: "t" })).toBeNull();
    expect(events).toHaveLength(0);
  });

  test("listMissions filters by exact source_zcode_session_id", () => {
    const { store } = newStore(newDir());
    const linked = store.saveMission("tenant-acme", newMission("tenant-acme", "m-1"));
    store.linkSession("tenant-acme", linked.id, { sessionId: "sess-a", taskId: "sess-a" });
    store.saveMission("tenant-acme", newMission("tenant-acme", "m-2"));

    expect(store.listMissions("tenant-acme", { source_zcode_session_id: "sess-a" }).map((m) => m.id)).toEqual([
      "m-1",
    ]);
    expect(store.listMissions("tenant-acme")).toHaveLength(2);
  });

  test("corrupted store files fail closed (invalid JSON or wrong structure)", () => {
    const brokenJson = newDir();
    mkdirSync(brokenJson, { recursive: true });
    writeFileSync(join(brokenJson, STORE_FILE), "{ not json", "utf8");
    expect(() => newStore(brokenJson).store.listMissions("tenant-acme")).toThrow(
      ContractValidationError,
    );

    const wrongShape = newDir();
    mkdirSync(wrongShape, { recursive: true });
    writeFileSync(join(wrongShape, STORE_FILE), JSON.stringify({ version: 1, missions: "nope" }), "utf8");
    expect(() => newStore(wrongShape).store.listMissions("tenant-acme")).toThrow(
      ContractValidationError,
    );
  });
});
