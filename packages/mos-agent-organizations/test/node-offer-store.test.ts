import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractValidationError,
  InvariantViolation,
  nodeOfferSchema,
} from "@mos/contracts";
import {
  NodeOfferNotFoundError,
  NodeOfferStore,
  OfferPublishBlockedError,
  nodeOfferFromDraftInput,
} from "../src/index.js";
import type { NodeOfferDraftInput, TimeSource } from "../src/index.js";

/**
 * NodeOfferStore 矩阵：§8 fail-closed 发布门禁、tenant 隔离、
 * published 列表语义（withdrawn/expired/draft 绝不表面化）与持久化。
 */

const T1 = "2026-11-13T00:00:00Z";
const T2 = "2026-11-13T01:00:00Z";
const T3 = "2026-11-13T02:00:00Z";
const STORE_FILE = "mos-node-offers.json";

/** 可变时钟：验证 publish/withdraw 推进 updated_at。 */
class MutableClock implements TimeSource {
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
  const dir = mkdtempSync(join(tmpdir(), "mos-node-offers-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 全未知草稿输入（§8 披露字段全部 null）。 */
function draftInputFor(
  tenantId: string,
  id: string,
  overrides: Partial<NodeOfferDraftInput> = {},
): NodeOfferDraftInput {
  return {
    tenant_id: tenantId,
    node_ref: { kind: "human", id: `body-${id}` },
    capability_id: null,
    inputs: null,
    deliverables: null,
    availability: null,
    geography: null,
    language: null,
    price_reward: null,
    deadline: null,
    sla: null,
    rights_constraints: null,
    acceptance_evaluator: null,
    evidence_refs: null,
    delivery_history: null,
    ...overrides,
  };
}

/** 全披露草稿输入（§8 每个字段都已披露；inputs/rights/delivery_history 显式空数组 = 披露"无"）。 */
function disclosedInputFor(
  tenantId: string,
  id: string,
  overrides: Partial<NodeOfferDraftInput> = {},
): NodeOfferDraftInput {
  return draftInputFor(
    tenantId,
    id,
    {
      capability_id: "cap-copywriting",
      inputs: [],
      deliverables: ["landing page copy"],
      availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: "2 concurrent" },
      geography: "global",
      language: "en",
      price_reward: { amount: "120.00", currency: "USD" },
      deadline: "2026-12-31T23:59:59Z",
      sla: "48h first draft",
      rights_constraints: [],
      acceptance_evaluator: { evaluator_ref: "eval-1", method: "human review panel" },
      evidence_refs: ["ev-1"],
      delivery_history: [],
      ...overrides,
    },
  );
}

function newStore(dir: string, time?: TimeSource): NodeOfferStore {
  return new NodeOfferStore({ directory: dir, time });
}

function saveDraft(
  store: NodeOfferStore,
  tenantId: string,
  id: string,
  input: NodeOfferDraftInput,
  now = T1,
) {
  return store.save(tenantId, nodeOfferFromDraftInput(input, { id, now }));
}

describe("NodeOfferStore (durable, tenant-scoped, fail-closed publish gate)", () => {
  test("missing file starts empty; draft creation with explicit nulls stays draft after reload", () => {
    const dir = newDir();
    const store = newStore(dir);
    expect(store.listByTenant("tenant-acme")).toEqual([]);

    const draft = saveDraft(store, "tenant-acme", "offer-1", draftInputFor("tenant-acme", "1"));
    expect(draft.status).toBe("draft");

    // durable：同目录新实例重载后，显式 null 的草稿仍是 draft（§8 未知保持未知）。
    const reloaded = newStore(dir).get("tenant-acme", "offer-1");
    expect(reloaded.status).toBe("draft");
    expect(reloaded.geography).toBeNull();
    expect(reloaded.acceptance_evaluator).toBeNull();
    expect(reloaded.deliverables).toBeNull();
    expect(reloaded.availability).toBeNull();
  });

  test("durability: a new store instance on the same directory reloads records; atomic write leaves no tmp residue", () => {
    const dir = newDir();
    const first = newStore(dir);
    saveDraft(first, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1"));

    expect(existsSync(join(dir, STORE_FILE))).toBe(true);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const second = newStore(dir);
    expect(second.get("tenant-acme", "offer-1").id).toBe("offer-1");
  });

  test("fully disclosed draft publishes: status published, record conforms to the shared nodeOfferSchema", () => {
    const store = newStore(newDir());
    saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1"));

    const published = store.publish("tenant-acme", "offer-1");
    expect(published.status).toBe("published");
    expect(published.geography).toBe("global");
    expect(() => nodeOfferSchema.parse(published)).not.toThrow();

    expect(store.get("tenant-acme", "offer-1").status).toBe("published");
  });

  test("publish blocked names exactly the missing disclosures (fail-closed, no silent defaults)", () => {
    const store = newStore(newDir());
    saveDraft(
      store,
      "tenant-acme",
      "offer-1",
      disclosedInputFor("tenant-acme", "1", { geography: null, sla: null }),
    );

    try {
      store.publish("tenant-acme", "offer-1");
      expect.unreachable("publish gate must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(OfferPublishBlockedError);
      const blocked = error as OfferPublishBlockedError;
      expect(blocked.missingDisclosures).toEqual(["geography", "sla"]);
      // fail-closed：记录仍是 draft，无任何字段被默认补全。
      expect(store.get("tenant-acme", "offer-1").status).toBe("draft");
      expect(store.get("tenant-acme", "offer-1").geography).toBeNull();
    }
  });

  test("empty availability disclosure blocks; half-disclosed availability (windows only) publishes", () => {
    const store = newStore(newDir());
    saveDraft(
      store,
      "tenant-acme",
      "offer-1",
      disclosedInputFor("tenant-acme", "1", { availability: { windows: null, capacity: null } }),
    );
    try {
      store.publish("tenant-acme", "offer-1");
      expect.unreachable("publish gate must reject empty availability");
    } catch (error) {
      expect(error).toBeInstanceOf(OfferPublishBlockedError);
      expect((error as OfferPublishBlockedError).missingDisclosures).toEqual(["availability"]);
    }

    saveDraft(
      store,
      "tenant-acme",
      "offer-2",
      disclosedInputFor("tenant-acme", "2", {
        availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: null },
      }),
    );
    expect(store.publish("tenant-acme", "offer-2").status).toBe("published");
  });

  test("all-unknown draft is blocked naming every required disclosure", () => {
    const store = newStore(newDir());
    saveDraft(store, "tenant-acme", "offer-1", draftInputFor("tenant-acme", "1"));

    try {
      store.publish("tenant-acme", "offer-1");
      expect.unreachable("publish gate must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(OfferPublishBlockedError);
      expect((error as OfferPublishBlockedError).missingDisclosures).toEqual([
        "capability_id",
        "deliverables",
        "availability",
        "geography",
        "language",
        "price_reward",
        "deadline",
        "sla",
        "rights_constraints",
        "acceptance_evaluator",
        "evidence_refs",
        "delivery_history",
      ]);
    }
  });

  test("publish applies the patch verbatim (present keys replace, absent keys stay, no defaults)", () => {
    const store = newStore(newDir());
    saveDraft(
      store,
      "tenant-acme",
      "offer-1",
      disclosedInputFor("tenant-acme", "1", {
        geography: null,
        price_reward: null,
        evidence_refs: null,
      }),
    );

    const published = store.publish("tenant-acme", "offer-1", {
      geography: "EU",
      price_reward: { amount: "90.00", currency: "EUR" },
      evidence_refs: ["ev-2", "ev-3"],
    });
    expect(published.geography).toBe("EU");
    expect(published.price_reward).toEqual({ amount: "90.00", currency: "EUR" });
    expect(published.evidence_refs).toEqual(["ev-2", "ev-3"]);
    // 补丁缺席的键保持草稿原值（无默认、无推断）。
    expect(published.sla).toBe("48h first draft");
    expect(published.deadline).toBe("2026-12-31T23:59:59Z");
  });

  test("publish with an insufficient patch still blocks (patch cannot bypass the gate)", () => {
    const store = newStore(newDir());
    saveDraft(store, "tenant-acme", "offer-1", draftInputFor("tenant-acme", "1"));

    expect(() => store.publish("tenant-acme", "offer-1", { geography: "EU" })).toThrow(
      OfferPublishBlockedError,
    );
    expect(store.get("tenant-acme", "offer-1").status).toBe("draft");
  });

  test("publish on unknown offer fails with NodeOfferNotFoundError; cross-tenant publish fails closed", () => {
    const store = newStore(newDir());
    saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1"));

    expect(() => store.publish("tenant-acme", "offer-missing")).toThrow(NodeOfferNotFoundError);
    expect(() => store.publish("tenant-globex", "offer-1")).toThrow(InvariantViolation);
    expect(() => store.get("tenant-globex", "offer-1")).toThrow(InvariantViolation);
    // 跨租户写入同样 fail-closed。
    expect(() =>
      store.save(
        "tenant-globex",
        nodeOfferFromDraftInput(disclosedInputFor("tenant-acme", "1"), { id: "offer-9", now: T1 }),
      ),
    ).toThrow(InvariantViolation);
  });

  test("listPublishedByCapability surfaces only published offers of the tenant for that capability", () => {
    const store = newStore(newDir());
    // offer-1：published（cap-1）。
    saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1", { capability_id: "cap-1" }));
    store.publish("tenant-acme", "offer-1");
    // offer-2：draft（cap-1）——绝不表面化。
    saveDraft(store, "tenant-acme", "offer-2", disclosedInputFor("tenant-acme", "2", { capability_id: "cap-1" }));
    // offer-3：published 后撤回（cap-1）——绝不表面化。
    saveDraft(store, "tenant-acme", "offer-3", disclosedInputFor("tenant-acme", "3", { capability_id: "cap-1" }));
    store.publish("tenant-acme", "offer-3");
    store.withdraw("tenant-acme", "offer-3");
    // offer-4：published 但另一能力（cap-2）。
    saveDraft(store, "tenant-acme", "offer-4", disclosedInputFor("tenant-acme", "4", { capability_id: "cap-2" }));
    store.publish("tenant-acme", "offer-4");
    // offer-5：另一租户的 published（cap-1）——对 tenant-acme 不可见。
    saveDraft(store, "tenant-globex", "offer-5", disclosedInputFor("tenant-globex", "5", { capability_id: "cap-1" }));
    store.publish("tenant-globex", "offer-5");
    // offer-6：expired 状态的记录（非 published）——绝不表面化。
    const expired = nodeOfferFromDraftInput(disclosedInputFor("tenant-acme", "6", { capability_id: "cap-1" }), { id: "offer-6", now: T1 });
    store.save("tenant-acme", { ...expired, status: "expired" });

    const listed = store.listPublishedByCapability("tenant-acme", "cap-1");
    expect(listed.map((offer) => offer.id)).toEqual(["offer-1"]);
    expect(listed[0]?.status).toBe("published");
    // 全部结果符合共享契约。
    for (const offer of listed) {
      expect(() => nodeOfferSchema.parse(offer)).not.toThrow();
    }
    expect(store.listPublishedByCapability("tenant-acme", "cap-2").map((offer) => offer.id)).toEqual([
      "offer-4",
    ]);
    expect(store.listPublishedByCapability("tenant-acme", "cap-none")).toEqual([]);
  });

  test("withdrawn offer disappears from the published listing", () => {
    const store = newStore(newDir());
    saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1", { capability_id: "cap-1" }));
    store.publish("tenant-acme", "offer-1");
    expect(store.listPublishedByCapability("tenant-acme", "cap-1")).toHaveLength(1);

    const withdrawn = store.withdraw("tenant-acme", "offer-1");
    expect(withdrawn.status).toBe("withdrawn");
    expect(store.listPublishedByCapability("tenant-acme", "cap-1")).toEqual([]);
    expect(store.get("tenant-acme", "offer-1").status).toBe("withdrawn");
  });

  test("withdraw is idempotent: second withdraw does not rewrite or advance updated_at", () => {
    const dir = newDir();
    const clock = new MutableClock(T1);
    const store = newStore(dir, clock);
    saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1"));
    store.publish("tenant-acme", "offer-1");
    clock.advance(T2);
    const first = store.withdraw("tenant-acme", "offer-1");
    expect(first.updated_at).toBe(T2);

    clock.advance(T3);
    const second = store.withdraw("tenant-acme", "offer-1");
    expect(second.updated_at).toBe(T2);
  });

  test("updated_at changes on publish (injected clock); created_at untouched", () => {
    const clock = new MutableClock(T1);
    const store = newStore(newDir(), clock);
    const draft = saveDraft(store, "tenant-acme", "offer-1", disclosedInputFor("tenant-acme", "1"));
    expect(draft.updated_at).toBe(T1);

    clock.advance(T2);
    const published = store.publish("tenant-acme", "offer-1");
    expect(published.status).toBe("published");
    expect(published.created_at).toBe(T1);
    expect(published.updated_at).toBe(T2);
    expect(store.get("tenant-acme", "offer-1").updated_at).toBe(T2);
  });

  test("save of a published record missing disclosures is blocked (no gate bypass via upsert)", () => {
    const store = newStore(newDir());
    const draft = nodeOfferFromDraftInput(
      disclosedInputFor("tenant-acme", "1", { geography: null }),
      { id: "offer-1", now: T1 },
    );
    expect(() => store.save("tenant-acme", { ...draft, status: "published" })).toThrow(
      OfferPublishBlockedError,
    );
    expect(store.listByTenant("tenant-acme")).toEqual([]);
  });

  test("save of a fully disclosed published record persists through the gate and final guard", () => {
    const store = newStore(newDir());
    const draft = nodeOfferFromDraftInput(disclosedInputFor("tenant-acme", "1"), {
      id: "offer-1",
      now: T1,
    });
    const saved = store.save("tenant-acme", { ...draft, status: "published" });
    expect(saved.status).toBe("published");
    expect(store.listPublishedByCapability("tenant-acme", "cap-copywriting")).toHaveLength(1);
  });

  test("publish with unknown inputs (null) fails closed at materialization (never silently defaulted)", () => {
    const store = newStore(newDir());
    saveDraft(
      store,
      "tenant-acme",
      "offer-1",
      disclosedInputFor("tenant-acme", "1", { inputs: null }),
    );

    expect(() => store.publish("tenant-acme", "offer-1")).toThrow(ContractValidationError);
    expect(store.get("tenant-acme", "offer-1").status).toBe("draft");
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
      JSON.stringify({ version: 1, node_offers: "nope" }),
      "utf8",
    );
    expect(() => newStore(wrongShape).listByTenant("tenant-acme")).toThrow(
      ContractValidationError,
    );
  });
});
