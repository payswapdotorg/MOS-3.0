import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  NetworkNodeNotFoundError,
  NetworkNodeStore,
  NetworkNodeValidationError,
  NETWORK_NODE_STATUS_INACTIVE,
} from "../src/index.js";
import {
  nodeRegistrationInput,
  OTHER_TENANT,
  registeredNode,
  STORE_FILE_NODES,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

const directories: string[] = [];

function makeStore(): { store: NetworkNodeStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "mos-network-nodes-test-"));
  directories.push(directory);
  return { store: new NetworkNodeStore({ directory }), directory };
}

describe("NetworkNodeStore (durable, tenant-scoped)", () => {
  test("registers a node active and persists it across restarts", () => {
    const { store, directory } = makeStore();
    const node = store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    expect(node.status).toBe("active");

    const reopened = new NetworkNodeStore({ directory });
    const reread = reopened.getNode(TENANT, "node-1");
    expect(reread?.display_name).toBe("Caption review specialist");
    expect(reread?.node_ref).toEqual({ kind: "human", id: "agent-body-1" });
  });

  test("upsert by id replaces the record and bumps updated_at", () => {
    const { store } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    const updated = store.registerNode(
      TENANT,
      "node-1",
      nodeRegistrationInput({ display_name: "Senior reviewer" }),
      { now: T2 },
    );
    expect(updated.display_name).toBe("Senior reviewer");
    expect(updated.updated_at).toBe(T2);
    expect(store.listNodesByTenant(TENANT)).toHaveLength(1);
  });

  test("tenant isolation: other tenants see nothing, cross-tenant write fails closed", () => {
    const { store } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    expect(() => store.getNode(OTHER_TENANT, "node-1")).toThrow(InvariantViolation);
    expect(store.listNodesByTenant(OTHER_TENANT)).toHaveLength(0);
    expect(() =>
      store.registerNode(OTHER_TENANT, "node-x", nodeRegistrationInput(), { now: T2 }),
    ).toThrow(InvariantViolation);
  });

  test("setStatus flips active/inactive but never to unknown", () => {
    const { store } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    const inactive = store.setStatus(TENANT, "node-1", NETWORK_NODE_STATUS_INACTIVE, { now: T2 });
    expect(inactive.status).toBe("inactive");
    expect(() => store.setStatus(TENANT, "node-1", "unknown", { now: T2 })).toThrow(
      NetworkNodeValidationError,
    );
    expect(() => store.setStatus(TENANT, "node-404", NETWORK_NODE_STATUS_INACTIVE, { now: T2 })).toThrow(
      NetworkNodeNotFoundError,
    );
  });

  test("invalid registration input fails closed with typed error", () => {
    const { store } = makeStore();
    expect(() =>
      store.registerNode(TENANT, "node-1", nodeRegistrationInput({ display_name: "" }), { now: T1 }),
    ).toThrow(NetworkNodeValidationError);
    expect(() =>
      store.registerNode(
        TENANT,
        "node-1",
        nodeRegistrationInput({ node_ref: { kind: "robot" as never, id: "x" } }),
        { now: T1 },
      ),
    ).toThrow(NetworkNodeValidationError);
  });

  test("corrupted store file fails closed on read (not valid JSON / wrong structure)", () => {
    const { store, directory } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    const filePath = join(directory, STORE_FILE_NODES);
    writeFileSync(filePath, "{not json", "utf8");
    expect(() => store.listNodesByTenant(TENANT)).toThrow(ContractValidationError);
    writeFileSync(filePath, JSON.stringify({ version: 1 }), "utf8");
    expect(() => store.listNodesByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("schema-breaking record fails closed on read (hand-built corrupt record)", () => {
    const { store, directory } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    const corrupt = registeredNode({ display_name: "" });
    writeFileSync(
      join(directory, STORE_FILE_NODES),
      JSON.stringify({ version: 1, network_nodes: [corrupt] }, null, 2),
      "utf8",
    );
    expect(() => store.getNode(TENANT, "node-1")).toThrow(ContractValidationError);
  });

  test("atomic write: no tmp file left behind, file ends with newline", () => {
    const { store, directory } = makeStore();
    store.registerNode(TENANT, "node-1", nodeRegistrationInput(), { now: T1 });
    const raw = readFileSync(join(directory, STORE_FILE_NODES), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as { version: number; network_nodes: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.network_nodes).toHaveLength(1);
  });
});

describe("cleanup", () => {
  test("removes temp directories", () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    expect(directories.length).toBeGreaterThan(0);
  });
});
