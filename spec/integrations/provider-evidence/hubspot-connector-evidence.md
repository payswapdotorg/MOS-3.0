# HubSpot connector evidence record

Adapter: `@mos/integrations` HubSpot read adapter (packages/mos-integrations).
Descriptor: `hubspotProviderDescriptor` (packages/mos-integrations/src/contract/hubspot-descriptor.ts).
Connector template: `packages/mos-integrations/src/connector/hubspot-connector-template/.zcode-plugin/plugin.json` (`mos-hubspot-connector` 0.1.0).

## Status (AGENTS.md §7 vocabulary only)

- Connector template + provider descriptor + read adapter + connection store: **contract-tested**.
- Exact HubSpot MCP tool names and scope bindings: **UNVERIFIED** (no HubSpot test portal, OAuth
  client or provider account exists in this environment). `toolMappingVerified: false` is the true
  current state, and the capability resolver therefore only resolves `unknown` / `unavailable`
  for this provider — never `available`.
- Live read against the real HubSpot MCP server: **blocked** (no provider account). No live tool
  call has been made; nothing in this record claims one.
- Live write: **deferred** (out of scope for W1; requires explicit user approval per strategy §6).

## 1. Provider identity and official documentation

- Provider: HubSpot, official remote MCP server, HTTP transport: `https://mcp.hubspot.com/`
- Official documentation: <https://developers.hubspot.com/mcp> (also referenced verbatim by the
  server's own `resource_documentation` field below)
- Auth method declared by the connector template and descriptor: OAuth 2.0
  `authorization_code` flow, executed through ZCode's existing MCP OAuth support
  (strategy §4: reuse MCP OAuth and credential store; no second secret storage).

## 2. Live observations (verified 2026-11-12 UTC, kept verbatim)

Method: unauthenticated `curl` GET against the server's well-known endpoints (no credentials
involved; no account needed for these endpoints).

1. `https://mcp.hubspot.com/.well-known/oauth-authorization-server` → HTTP 200
2. `https://mcp.hubspot.com/.well-known/oauth-protected-resource` →
   `{"resource":"https://mcp.hubspot.com","authorization_servers":["https://mcp.hubspot.com"],"scopes_supported":[],"resource_documentation":"https://developers.hubspot.com/mcp"}`

Re-verified 2026-11-12T21:11Z (same day): both endpoints returned HTTP 200 /
`application/json`. The authorization-server metadata additionally declares
`issuer: https://mcp.hubspot.com`, authorization endpoint
`https://mcp.hubspot.com/oauth/authorize/user`, token endpoint
`https://mcp.hubspot.com/oauth/v3/token`, and `grant_types_supported` including
`authorization_code` and `refresh_token` — consistent with the descriptor's
`authMethod: oauth_authorization_code`.

Interpretation (honest limits):

- These observations prove the server exists, is reachable, advertises itself as an OAuth 2.0
  Authorization Server and protected resource, and documents an authorization-code flow.
- `scopes_supported` is `[]` in the metadata. **No scope list could be observed without an
  authorized account.** Exact scope strings for CRM object reads are UNVERIFIED; the
  candidate scope string `crm.objects.contacts.read` used in fixtures/descriptors is a
  candidate only, not an observed grant.
- The endpoints above are the ONLY live HubSpot observations in this record. Everything else in
  this file is contract-level (local stand-in) evidence.

## 3. Exact API / MCP server / tool names

- MCP server (exact): remote HTTP server `https://mcp.hubspot.com/`, server name used by the
  connector template: `hubspot`.
- MCP server version: UNVERIFIED (no live session; version discovery requires `initialize`
  over an authorized connection).
- Exact tool names: UNVERIFIED. No `tools/list` has been executed against the live server.
  Candidate tool name (used by the read adapter at contract level only):
  `hubspot_search_contacts` — `verified: false`, `verifiedAt: null`. Candidate argument shape
  (`query`, optional `limit`): UNVERIFIED.
- Candidate tool names live ONLY in the adjacent MOS provider descriptor, never in the ZCode
  `plugin.json` manifest (machine-checked by
  `packages/mos-integrations/test/connector-template.test.ts`).

## 4. OAuth client / app state and approved scopes

- OAuth client (HubSpot developer app): **none provisioned** in this environment. No client id,
  client secret, or app review submission exists. No secret values are recorded here, ever.
- Approved scopes: none observed (no account, no client; `scopes_supported: []` in metadata).

## 5. Account type and tenant eligibility

- UNVERIFIED. No HubSpot portal (test or production) is connected. Portal id used in
  fixtures (`portal-1025010`) is a synthetic placeholder, not a real account.
- Tenant eligibility is resolved per tenant by
  `@mos/capabilities` `CapabilityInstanceResolverService` from stored connection facts; with
  `toolMappingVerified=false` every resolution is `unknown`/`unavailable` with
  `missing_preconditions: ["tool_mapping_unverified"]`.

## 6. Test account identity (redacted/safe form)

- None. No provider account was provisioned or used. No personal data or customer records
  exist in any test fixture: contact fixtures are synthetic (`contact-101`, `ada@acme.example`).

## 7. Actual request/response evidence and timestamps

No live provider request/response exists (live read blocked). Contract-level evidence actually
produced and verified (all 2026-11-12 UTC, commands in §9):

- Real ZCode MCP client stack over a local stand-in stdio MCP server, plus the real shared
  ZCode credential store (encrypted at rest): `packages/zcode-mos-adapters/test/integration/mcp-real-stack.test.ts`.
  - `connectServer` (stdio stand-in) → `connected`;
  - `listTools` → stand-in tool surfaced with `readOnlyHint: true`, canonical name
    `mcp__standin-hubspot__hubspot_search_contacts`;
  - `callTool { query: "newsletter subscribers" }` → `isError: false`, structured content
    passthrough `{"records":[],"query":"newsletter subscribers"}`;
  - credential store round-trip: save/load/delete of an opaque key, with on-disk bytes
    verifiably NOT containing the stored value (plaintext check).
  - This proves the `ProviderPort` seam fits the real ZCode MCP client and the real credential
    store. It is NOT evidence about the real HubSpot server.
- Read adapter contract tests over `InMemoryProviderPort` (scripted stand-in, labeled
  contract-only): success path produces an `Evidence` object whose `facts` carry only
  counts/shapes (`record_count`, `record_count_basis`, `content_block_types`,
  `structured_content_keys`, `record_fields`); serialized evidence provably contains no
  contact record values (machine-checked in `test/read-adapter.test.ts`).
- Correlation: each read produces `Evidence.source = { observed_via: "hubspot-mcp", tool,
  connection_id }` and `observed_at` via injected `TimePort`, enabling later correlation of
  live evidence once an account exists.

## 8. Negative tests (contract-level matrix over the stand-in server)

All executed in `packages/mos-integrations/test/read-adapter.test.ts` (stand-in responses; the
same matrix must be re-run against the live server per §10):

| Simulated provider failure | Classified kind | Action | Instance invalidation |
| --- | --- | --- | --- |
| `HTTP 401: token expired or revoked; re-auth required` (expired token) | `unauthorized` | `invalidate_instance` | yes |
| `HTTP 403: insufficient permissions for crm.objects.contacts.read` (missing scope) | `insufficient_scope` | `invalidate_instance` | yes |
| `portal not found for this account (account mismatch)` (unauthorized target/wrong account) | `wrong_account` | `invalidate_instance` | yes |
| `HTTP 429: rate limit exceeded` | `rate_limited` | `backoff_and_surface` | no |
| unrecognized failure text | `unknown` | `fail_closed` | no |

Additional fail-closed behavior covered by tests:

- Missing connection (or cross-tenant connection id) → typed `ConnectionNotFoundError`, and the
  provider port records zero tool calls (no provider call is ever made).
- Classified failure messages pass through `redactProviderMessage`: token-shaped material is
  replaced with `[redacted]` (machine-checked).
- Connection store: unknown-field rejection at the write boundary, inline-token rejection
  (`credential_ref` must stay an opaque ref like `mcp:oauth:<24hex>`), tenant isolation
  (another tenant can never read or delete), durability across store reload, atomic write
  (no temp files left), corrupt file fails closed instead of silently resetting.

## 9. Quota / rate-limit result

- Not observed (no live call made). `429` handling is contract-tested only (see §8). The
  descriptor and implementation record `rate_limit_notes: null` until live observation.

## 10. Limitations, review status and fallback

- Limitations: exact tool names, argument schemas, scope strings, server version, quota
  behavior and account eligibility are all UNVERIFIED. Nothing here may be reported as a
  working HubSpot integration (AGENTS.md §4: no mock may be reported as proof of a real
  provider integration).
- Review status: no HubSpot app review submission exists (no client). `app_review_status`
  stays `null` in connection records until observed.
- Fallback: with `toolMappingVerified=false`, route planning must treat HubSpot capabilities
  as `unknown`/`unavailable` and disclose `tool_mapping_unverified` as the missing
  precondition. Manual export/import remains the human fallback for CRM data.

## 11. Live-verification plan (unblocks the `blocked` live read)

1. Provision a HubSpot developer test portal + private app / OAuth client (test accounts only;
   no production account without explicit user approval).
2. Authorize through ZCode's existing MCP OAuth flow (connector template
   `mos-hubspot-connector`, `authorization_code`) — never a hand-rolled token flow.
3. `listTools` over the authorized connection; record the exact tool names and input schemas in
   this file (redacted, no personal data).
4. Verify the descriptor tool mapping: set `toolMapping.verified=true` with `verifiedAt` only
   after the observed tool name matches the descriptor's declared tool name; otherwise update
   the descriptor and bump its version.
5. Execute exactly one real read (contact search) through `HubSpotReadAdapter`; record
   `Evidence` (counts/shapes only) + correlation facts (connection id, tool name, observed_at).
6. Re-run the §8 negative matrix against the live server (revoke token, drop scope, wrong
   portal, rate-limit window) and record outcomes.
7. Re-resolve the capability instance: expect `available` only when connection + scopes +
   verified mapping + evidence all hold; otherwise record the remaining preconditions.

## 12. Reproducible test commands and exact source commit

- Branch: `w1/integration-foundation`, commit `e7099a74ef4e1078688117ad6e3cfbf282d78a03`
  (mos-* packages are working-tree additions at the time of writing; commands below reproduce
  the contract-level evidence).
- `pnpm install --reporter=silent`
- `pnpm --filter @mos/integrations typecheck && pnpm --filter @mos/integrations test`
- `pnpm --filter @mos/capabilities typecheck && pnpm --filter @mos/capabilities test`
- Real-stack contract test (stand-in server over the REAL ZCode MCP client + REAL credential
  store), requires the CLI adapter dist build first:
  `pnpm --filter @zcode/adapters... build && pnpm --filter @mos/adapters test`
