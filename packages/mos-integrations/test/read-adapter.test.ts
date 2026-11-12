import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { InMemoryProviderPort, type TimePort } from "@mos/adapters";
import { assertEvidenceProvenance, evidenceSchema } from "@mos/contracts";
import {
  ConnectionNotFoundError,
  ConnectionStore,
  HUBSPOT_SEARCH_CONTACTS_TOOL,
  HubSpotReadAdapter,
  hubspotProviderDescriptor,
  summarizeProviderReadResult,
} from "../src/index.js";

const FIXED_NOW = "2026-11-12T00:00:00Z";

const fixedTime: TimePort = { now: () => FIXED_NOW };

const CONTACTS = [
  { id: "contact-101", email: "ada@acme.example", firstname: "Ada", lastname: "Lovelace" },
  { id: "contact-102", email: "grace@acme.example", firstname: "Grace", lastname: "Hopper" },
];

interface StandinResponse {
  readonly content: readonly { type: string; text: string }[];
  readonly isError: false;
  readonly structuredContent: unknown;
}

function defaultContactsResponse(): StandinResponse {
  return {
    content: [{ type: "text", text: '{"records":2}' }],
    isError: false,
    structuredContent: { results: CONTACTS, total: CONTACTS.length },
  };
}

const tempDirs: string[] = [];

interface Harness {
  provider: InMemoryProviderPort;
  adapter: HubSpotReadAdapter;
  store: ConnectionStore;
}

async function makeHarness(respond?: () => StandinResponse): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "mos-read-adapter-"));
  tempDirs.push(directory);
  const provider = new InMemoryProviderPort();
  provider.registerTool({
    serverName: "hubspot",
    toolName: HUBSPOT_SEARCH_CONTACTS_TOOL,
    description: "Search contacts (contract-level stand-in)",
    annotations: { readOnlyHint: true },
    respond: respond ?? (() => defaultContactsResponse()),
  });
  const store = new ConnectionStore({ directory });
  const adapter = new HubSpotReadAdapter({ provider, time: fixedTime, store });
  return { provider, adapter, store };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedConnection(harness: Harness): Promise<string> {
  const record = await harness.store.upsertConnection("tenant-acme", {
    provider_id: "hubspot",
    provider_account_id: "portal-1025010",
    auth_method: "oauth_authorization_code",
    credential_ref: "mcp:oauth:0f1e2d3c4b5a69788796a5b4",
    granted_scopes: ["crm.objects.contacts.read"],
    account_type: null,
    app_review_status: null,
    status: "connected",
    last_verified_at: FIXED_NOW,
  });
  return record.id;
}

describe("HubSpotReadAdapter (provider-neutral read)", () => {
  test("success path: evidence-backed read result with counts and shapes only", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme", limit: 25 },
    });

    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    const evidence = evidenceSchema.parse(outcome.evidence);
    assertEvidenceProvenance(evidence);
    expect(evidence.kind).toBe("provider_response");
    expect(evidence.tenant_id).toBe("tenant-acme");
    expect(evidence.observed_at).toBe(FIXED_NOW);
    expect(evidence.source["observed_via"]).toBe("hubspot-mcp");
    expect(evidence.source["tool"]).toBe(HUBSPOT_SEARCH_CONTACTS_TOOL);
    expect(evidence.source["connection_id"]).toBe(connectionId);
    expect(evidence.confidence).toBeNull();
    expect(evidence.limitations).toEqual([
      "contract-level stand-in or live read per provider evidence record",
    ]);
  });

  test("success path: facts carry counts/shapes and NEVER raw payloads", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;

    const serialized = JSON.stringify(outcome.evidence);
    for (const contact of CONTACTS) {
      expect(serialized).not.toContain(contact.email);
      expect(serialized).not.toContain(contact.firstname);
      expect(serialized).not.toContain(contact.id);
    }
    expect(outcome.evidence.facts["record_count"]).toBe(2);
    expect(outcome.evidence.facts["record_count_basis"]).toBe("structured_content");
    expect(outcome.evidence.facts["content_block_count"]).toBe(1);
    expect(outcome.evidence.facts["structured_content_keys"]).toEqual(["results", "total"]);
    expect(outcome.evidence.facts["record_fields"]).toEqual(["id", "email", "firstname", "lastname"]);
    expect(outcome.resultShape.recordCount).toBe(2);
    expect(outcome.resultShape.recordFields).toEqual(["id", "email", "firstname", "lastname"]);
  });

  test("reads through the declared candidate tool with provider-neutral arguments", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme", limit: 25 },
    });
    const call = harness.provider.recordedCalls()[0];
    expect(call?.request.serverName).toBe("hubspot");
    expect(call?.request.toolName).toBe(HUBSPOT_SEARCH_CONTACTS_TOOL);
    expect(call?.request.arguments).toEqual({ query: "acme", limit: 25 });
    expect(hubspotProviderDescriptor.toolMappingVerified).toBe(false);
  });

  test("text-only JSON results are counted via the text_json basis without embedding text", async () => {
    const harness = await makeHarness(() => ({
      content: [
        { type: "text", text: JSON.stringify({ contacts: [{ uid: "aa-111" }, { uid: "aa-222" }, { uid: "aa-333" }] }) },
      ],
      isError: false,
      structuredContent: null,
    }));
    const connectionId = await seedConnection(harness);

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "*" },
    });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.evidence.facts["record_count"]).toBe(3);
    expect(outcome.evidence.facts["record_count_basis"]).toBe("text_json");
    expect(outcome.evidence.facts["structured_content_keys"]).toBeNull();
    expect(outcome.evidence.facts["record_fields"]).toEqual(["uid"]);
    const serialized = JSON.stringify(outcome.evidence);
    expect(serialized).not.toContain("aa-111");
    expect(serialized).not.toContain('"contacts"');
  });

  test("missing connection: typed error and NO provider call", async () => {
    const harness = await makeHarness();
    await expect(
      harness.adapter.readContactsOnce({
        tenantId: "tenant-acme",
        connectionId: "missing-connection",
        query: { searchText: "acme" },
      }),
    ).rejects.toThrow(ConnectionNotFoundError);
    expect(harness.provider.recordedCalls()).toHaveLength(0);
  });

  test("missing connection never crosses tenants (store lookup is tenant-scoped)", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    await expect(
      harness.adapter.readContactsOnce({
        tenantId: "tenant-globex",
        connectionId,
        query: { searchText: "acme" },
      }),
    ).rejects.toThrow(ConnectionNotFoundError);
    expect(harness.provider.recordedCalls()).toHaveLength(0);
  });

  test("negative matrix: expired token (401) → unauthorized → invalidate_instance", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(HUBSPOT_SEARCH_CONTACTS_TOOL, "HTTP 401: token expired or revoked; re-auth required");

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      classified: { kind: "unauthorized", retryable: false },
      action: "invalidate_instance",
      invalidatedInstance: true,
    });
  });

  test("negative matrix: insufficient scope (403) → insufficient_scope → invalidate_instance", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(
      HUBSPOT_SEARCH_CONTACTS_TOOL,
      "HTTP 403: insufficient permissions for crm.objects.contacts.read",
    );

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      classified: { kind: "insufficient_scope", retryable: false },
      action: "invalidate_instance",
      invalidatedInstance: true,
    });
  });

  test("negative matrix: wrong account (portal mismatch) → wrong_account → invalidate_instance", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(HUBSPOT_SEARCH_CONTACTS_TOOL, "portal not found for this account (account mismatch)");

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      classified: { kind: "wrong_account" },
      action: "invalidate_instance",
      invalidatedInstance: true,
    });
  });

  test("negative matrix: rate limit (429) → rate_limited → backoff_and_surface (no invalidation)", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(HUBSPOT_SEARCH_CONTACTS_TOOL, "HTTP 429: rate limit exceeded");

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      classified: { kind: "rate_limited", retryable: true },
      action: "backoff_and_surface",
      invalidatedInstance: false,
    });
  });

  test("negative matrix: unrecognized failure → unknown → fail_closed", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(HUBSPOT_SEARCH_CONTACTS_TOOL, "something odd happened in the pipeline");

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      classified: { kind: "unknown", retryable: false },
      action: "fail_closed",
      invalidatedInstance: false,
    });
  });

  test("classified messages are redacted (no token material in failures)", async () => {
    const harness = await makeHarness();
    const connectionId = await seedConnection(harness);
    harness.provider.failNextToolCall(
      HUBSPOT_SEARCH_CONTACTS_TOOL,
      "HTTP 401: token expired ghp_0123456789abcdef0123456789abcdef",
    );

    const outcome = await harness.adapter.readContactsOnce({
      tenantId: "tenant-acme",
      connectionId,
      query: { searchText: "acme" },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.classified.message).not.toContain("ghp_0123456789abcdef");
    expect(outcome.classified.message).toContain("[redacted]");
  });
});

describe("summarizeProviderReadResult (pure shape summary)", () => {
  test("structured arrays and nested arrays both yield deterministic counts", () => {
    const fromArray = summarizeProviderReadResult({
      content: [],
      isError: false,
      structuredContent: [{ uid: "x-1" }],
    });
    expect(fromArray.recordCount).toBe(1);
    expect(fromArray.recordCountBasis).toBe("structured_content");
    expect(fromArray.structuredContentKeys).toBeNull();

    const fromObject = summarizeProviderReadResult({
      content: [],
      isError: false,
      structuredContent: { paging: null, records: [{ a: 1 }, { a: 2 }] },
    });
    expect(fromObject.recordCount).toBe(2);
    expect(fromObject.structuredContentKeys).toEqual(["paging", "records"]);
    expect(fromObject.recordFields).toEqual(["a"]);
  });

  test("unrecognizable results stay unknown (null counts, never guessed)", () => {
    const shape = summarizeProviderReadResult({
      content: [{ type: "text", text: "not json at all" }],
      isError: false,
      structuredContent: null,
    });
    expect(shape.recordCount).toBeNull();
    expect(shape.recordCountBasis).toBeNull();
    expect(shape.recordFields).toBeNull();
    expect(shape.contentBlockTypes).toEqual(["text"]);
    const objectWithoutArrays = summarizeProviderReadResult({
      content: [],
      isError: false,
      structuredContent: { total: 5, status: "ok" },
    });
    expect(objectWithoutArrays.recordCount).toBeNull();
    expect(objectWithoutArrays.structuredContentKeys).toEqual(["total", "status"]);
  });
});
