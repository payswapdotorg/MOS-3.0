import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ContractValidationError,
  InvariantViolation,
  providerConnectionSchema,
  type ProviderConnection,
} from "@mos/contracts";
import { ConnectionStore, type ConnectionUpsertInput } from "../src/index.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ store: ConnectionStore; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "mos-connection-store-"));
  tempDirs.push(directory);
  return { store: new ConnectionStore({ directory }), directory };
}

/**
 * 契约 upsert 输入构造器。显式返回类型：overrides 是 Record<string, unknown>
 * （负向测试要注入非法值），推断类型会把 status 等字面量字段放宽成 string。
 */
function baseUpsert(overrides: Record<string, unknown> = {}): ConnectionUpsertInput {
  return {
    provider_id: "hubspot",
    provider_account_id: "portal-1025010",
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ConnectionStore (tenant-scoped, durable, opaque refs only)", () => {
  test("generates an id and stores a contract-valid connection record", async () => {
    const { store } = await makeStore();
    const record = await store.upsertConnection("tenant-acme", baseUpsert());
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.tenant_id).toBe("tenant-acme");
    expect(() => providerConnectionSchema.parse(record)).not.toThrow();
    expect(record.credential_ref).toBe("mcp:oauth:0f1e2d3c4b5a69788796a5b4");
  });

  test("missing file starts empty (no fabricated connections)", async () => {
    const { store } = await makeStore();
    expect(await store.listConnections("tenant-acme", "hubspot")).toEqual([]);
    expect(await store.getConnection("tenant-acme", "hubspot", "missing")).toBeNull();
  });

  test("records survive store reload from the JSON file (durability)", async () => {
    const { store, directory } = await makeStore();
    const stored = await store.upsertConnection("tenant-acme", baseUpsert());
    const reloaded = new ConnectionStore({ directory });
    const found = await reloaded.getConnection("tenant-acme", "hubspot", stored.id);
    expect(found).toEqual(stored);
    const listed = await reloaded.listConnections("tenant-acme", "hubspot");
    expect(listed.map((connection) => connection.id)).toEqual([stored.id]);
  });

  test("upsert with an explicit id replaces the existing record", async () => {
    const { store } = await makeStore();
    const first = await store.upsertConnection("tenant-acme", baseUpsert());
    const revoked = await store.upsertConnection("tenant-acme", baseUpsert({
      id: first.id,
      status: "revoked",
      last_verified_at: null,
    }));
    expect(revoked.id).toBe(first.id);
    expect(revoked.status).toBe("revoked");
    expect(await store.listConnections("tenant-acme", "hubspot")).toHaveLength(1);
  });

  test("tenant scoping: another tenant never sees or deletes these connections", async () => {
    const { store } = await makeStore();
    const acme = await store.upsertConnection("tenant-acme", baseUpsert());
    await store.upsertConnection("tenant-globex", baseUpsert());

    expect((await store.listConnections("tenant-acme", "hubspot")).map((c) => c.id)).toEqual([acme.id]);
    expect(await store.listConnections("tenant-globex", "hubspot")).toHaveLength(1);
    expect(await store.getConnection("tenant-globex", "hubspot", acme.id)).toBeNull();
    expect(await store.deleteConnection("tenant-globex", "hubspot", acme.id)).toBe(false);
    expect(await store.getConnection("tenant-acme", "hubspot", acme.id)).not.toBeNull();
  });

  test("provider scoping: connections are filtered by provider_id", async () => {
    const { store } = await makeStore();
    const hubspot = await store.upsertConnection("tenant-acme", baseUpsert());
    await store.upsertConnection("tenant-acme", baseUpsert({ provider_id: "another-provider" }));

    expect((await store.listConnections("tenant-acme", "hubspot")).map((c) => c.id)).toEqual([hubspot.id]);
    expect(await store.getConnection("tenant-acme", "another-provider", hubspot.id)).toBeNull();
    expect(await store.deleteConnection("tenant-acme", "another-provider", hubspot.id)).toBe(false);
  });

  test("deleteConnection removes exactly the targeted record", async () => {
    const { store } = await makeStore();
    const keep = await store.upsertConnection("tenant-acme", baseUpsert());
    const drop = await store.upsertConnection("tenant-acme", baseUpsert());

    expect(await store.deleteConnection("tenant-acme", "hubspot", drop.id)).toBe(true);
    expect(await store.getConnection("tenant-acme", "hubspot", drop.id)).toBeNull();
    expect(await store.getConnection("tenant-acme", "hubspot", keep.id)).not.toBeNull();
    expect(await store.deleteConnection("tenant-acme", "hubspot", drop.id)).toBe(false);
  });

  test("contract defaults are applied on write (granted_scopes, nullable fields)", async () => {
    const { store } = await makeStore();
    const record = await store.upsertConnection("tenant-acme", {
      provider_id: "hubspot",
      auth_method: "oauth_authorization_code",
      credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
      status: "connected",
    });
    expect(record.granted_scopes).toEqual([]);
    expect(record.provider_account_id).toBeNull();
    expect(record.account_type).toBeNull();
    expect(record.app_review_status).toBeNull();
    expect(record.last_verified_at).toBeNull();
  });

  test("rejects an inline token in credential_ref (secrets stay opaque refs only)", async () => {
    const { store } = await makeStore();
    await expect(
      store.upsertConnection("tenant-acme", baseUpsert({
        credential_ref: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      })),
    ).rejects.toThrow(ContractValidationError);
    await expect(
      store.upsertConnection("tenant-acme", baseUpsert({
        credential_ref: "Bearer ghp_deadbeefdeadbeefdeadbeef",
      })),
    ).rejects.toThrow(ContractValidationError);
  });

  test("rejects unknown fields at the write boundary (no silent key stripping)", async () => {
    const { store } = await makeStore();
    await expect(
      store.upsertConnection("tenant-acme", baseUpsert({
        access_token: "opaque-or-not-this-must-never-persist",
      })),
    ).rejects.toThrow(InvariantViolation);
    await expect(
      store.upsertConnection("tenant-acme", baseUpsert({ tenant_id: "tenant-evil" })),
    ).rejects.toThrow(InvariantViolation);
  });

  test("persisted file holds only opaque refs (raw JSON scan)", async () => {
    const { store, directory } = await makeStore();
    await store.upsertConnection("tenant-acme", baseUpsert());
    const raw = await readFile(join(directory, "mos-connections.json"), "utf8");
    expect(raw).toContain("mcp:oauth:0f1e2d3c4b5a69788796a5b4");
    expect(raw).not.toMatch(/(eyJ|sk-|Bearer\s|ghp_)/);
    expect(raw).not.toContain("access_token");
    const parsed = JSON.parse(raw) as { connections: ProviderConnection[] };
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.connections[0]?.tenant_id).toBe("tenant-acme");
  });

  test("atomic write leaves no temp files behind", async () => {
    const { store, directory } = await makeStore();
    await store.upsertConnection("tenant-acme", baseUpsert());
    await store.upsertConnection("tenant-acme", baseUpsert({ status: "expired" }));
    const entries = await readdir(directory);
    expect(entries).toEqual(["mos-connections.json"]);
  });

  test("corrupt store file fails closed on load instead of silently resetting", async () => {
    const { store, directory } = await makeStore();
    await writeFile(join(directory, "mos-connections.json"), "{ not json", "utf8");
    await expect(store.listConnections("tenant-acme", "hubspot")).rejects.toThrow();
  });
});
