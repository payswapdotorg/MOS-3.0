import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  GigAssignmentBlockedError,
  GigNotFoundError,
  GigPublishBlockedError,
  GigStore,
  GigTransitionError,
  GigValidationError,
} from "../src/index.js";
import {
  AGENT_NODE_REF,
  draftGig,
  gigIntake,
  justifiedComparison,
  OTHER_TENANT,
  STORE_FILE_GIGS,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

const directories: string[] = [];

function makeStore(): { store: GigStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "mos-gigs-test-"));
  directories.push(directory);
  return { store: new GigStore({ directory }), directory };
}

function createDraft(store: GigStore, id = "gig-1") {
  return store.createGig(TENANT, gigIntake(), { id, now: T1 });
}

describe("GigStore (durable, tenant-scoped, gated transitions)", () => {
  test("creates a draft gig and persists it across restarts", () => {
    const { store, directory } = makeStore();
    const gig = createDraft(store);
    expect(gig.status).toBe("draft");

    const reopened = new GigStore({ directory });
    const reread = reopened.getGig(TENANT, "gig-1");
    expect(reread?.objective).toBe("Review final captions for regional compliance");
    expect(reread?.route_comparison).toBeNull();
  });

  test("invalid intake fails closed with typed error, nothing persisted", () => {
    const { store } = makeStore();
    expect(() =>
      store.createGig(TENANT, gigIntake({ script_brief: "" }), { id: "gig-1", now: T1 }),
    ).toThrow(GigValidationError);
    expect(store.listGigsByTenant(TENANT)).toHaveLength(0);
  });

  test("publish through the store enforces the §8 completeness gate", () => {
    const { store } = makeStore();
    store.createGig(TENANT, gigIntake({ deadline: null }), { id: "gig-1", now: T1 });
    expect(() => store.publishGig(TENANT, "gig-1", { now: T2 })).toThrow(GigPublishBlockedError);
    const still = store.getGig(TENANT, "gig-1");
    expect(still?.status).toBe("draft");
  });

  test("human assignment through the store enforces the §23 gate end to end", () => {
    const { store } = makeStore();
    createDraft(store);
    store.publishGig(TENANT, "gig-1", { now: T2 });

    expect(() =>
      store.assignGig(TENANT, "gig-1", { assigned_node_ref: { kind: "human", id: "agent-body-1" } }, { now: T2 }),
    ).toThrow(GigAssignmentBlockedError);

    const assigned = store.assignGig(
      TENANT,
      "gig-1",
      {
        assigned_node_ref: { kind: "human", id: "agent-body-1" },
        route_comparison: justifiedComparison(),
      },
      { now: T2 },
    );
    expect(assigned.status).toBe("assigned");
    expect(assigned.route_comparison?.recommendation).toBe("human");
  });

  test("agent assignment through the store needs no comparison", () => {
    const { store } = makeStore();
    createDraft(store);
    store.publishGig(TENANT, "gig-1", { now: T2 });
    const assigned = store.assignGig(
      TENANT,
      "gig-1",
      { assigned_node_ref: AGENT_NODE_REF },
      { now: T2 },
    );
    expect(assigned.assigned_node_ref?.kind).toBe("agent");
  });

  test("generic transitions through the store follow the legal state machine", () => {
    const { store } = makeStore();
    createDraft(store);
    store.publishGig(TENANT, "gig-1", { now: T2 });
    store.assignGig(TENANT, "gig-1", { assigned_node_ref: AGENT_NODE_REF }, { now: T2 });
    store.applyTransition(TENANT, "gig-1", "in_progress", { now: T2 });
    store.applyTransition(TENANT, "gig-1", "delivered", { now: T2 });
    expect(() => store.applyTransition(TENANT, "gig-1", "in_progress", { now: T2 })).toThrow(
      GigTransitionError,
    );
    expect(store.getGig(TENANT, "gig-1")?.status).toBe("delivered");
  });

  test("tenant isolation: other tenants see nothing, cross-tenant write fails closed", () => {
    const { store } = makeStore();
    createDraft(store);
    expect(() => store.getGig(OTHER_TENANT, "gig-1")).toThrow(InvariantViolation);
    expect(store.listGigsByTenant(OTHER_TENANT)).toHaveLength(0);
    expect(() =>
      store.assignGig(OTHER_TENANT, "gig-1", { assigned_node_ref: AGENT_NODE_REF }, { now: T2 }),
    ).toThrow(InvariantViolation);
    expect(() => store.publishGig(OTHER_TENANT, "gig-404", { now: T2 })).toThrow(GigNotFoundError);
  });

  test("corrupted store file fails closed on read", () => {
    const { store, directory } = makeStore();
    createDraft(store);
    writeFileSync(join(directory, STORE_FILE_GIGS), "not json", "utf8");
    expect(() => store.listGigsByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("hand-built §23-violating record fails closed at the transition boundary", () => {
    const { store, directory } = makeStore();
    createDraft(store);
    // 直接落盘一条绕过领域层的 assigned-to-human 记录（无比较；schema 合法但违反 §23）。
    const corrupt = {
      ...draftGig({ status: "assigned", assigned_node_ref: { kind: "human", id: "agent-body-1" } }),
    };
    writeFileSync(
      join(directory, STORE_FILE_GIGS),
      JSON.stringify({ version: 1, gigs: [corrupt] }, null, 2),
      "utf8",
    );
    // 读回不猜（schema 合法即返回）；任何状态转移边界都会再跑 §23 终守卫。
    expect(store.getGig(TENANT, "gig-1")?.status).toBe("assigned");
    expect(() => store.applyTransition(TENANT, "gig-1", "in_progress", { now: T2 })).toThrow(
      InvariantViolation,
    );
  });
});

describe("cleanup", () => {
  test("removes temp directories", () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    expect(directories.length).toBeGreaterThan(0);
  });
});
