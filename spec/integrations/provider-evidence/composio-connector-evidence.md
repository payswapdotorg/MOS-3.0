# Composio connector evidence record

## Status (AGENTS.md §7 vocabulary only)

- Provider account (project API key): **connected** (verified 2026-11-13 UTC; see §2/§7)
- Real provider read: **verified** (one real external-data read through the real ZCode MCP
  client stack + the real Composio hosted session MCP; see §7)
- Tool mapping: **verified** (live `tools/list` enumeration + executed read; see §4)
- HubSpot connector (separate record): still `blocked` — no HubSpot account/OAuth client in
  this environment; nothing in this record changes that record's status.

## 1. Provider identity and official documentation

- Provider: Composio (integration/tool-hosting platform), `providerId: composio`.
- Official docs (observed 2026-11-13 UTC):
  - Sessions via MCP: https://docs.composio.dev/docs/sessions-via-mcp
  - Current REST API (v3.1) base: `https://backend.composio.dev/api/v3.1`
    (https://docs.composio.dev/reference)
- Transport used: the documented **hosted session MCP** — `POST /api/v3.1/tool_router/session`
  with `mcp: true` returns `session.mcp.url` (streamable HTTP MCP at
  `https://backend.composio.dev/tool_router/<session_id>/mcp`). The MCP endpoint accepts the
  same `x-api-key` header as the REST API (documented; observed live, §2).
- This is the provider's documented auth shape for session MCP access — not a hand-rolled
  token flow. No OAuth code path is involved for the no-auth toolkit used below.
- Authorization material handling: the API key exists only in the environment
  (`COMPOSIO_API_KEY`) and the real ZCode encrypted credential store (opaque ref shape
  `mcp:apikey:<scope>`); it is never present in source, tests, logs, this record, or any
  persisted repo file.

## 2. Live observations (verified 2026-11-13 UTC, kept verbatim)

All observations below were made from the live service (curl probes + the live integration
suite `composio-live-stack.test.ts`, run 2026-11-13 00:51–00:53 UTC, 5/5 PASS):

1. `POST https://backend.composio.dev/api/v3.1/tool_router/session` with `x-api-key`,
   body `{user_id, mcp: true, toolkits: {enable: ["hackernews"]}}` → **201 Created**
   (also observed 200 on repeat) with `session_id` (`trs_*`) and
   `mcp.url = https://backend.composio.dev/tool_router/<session_id>/mcp`, `mcp.type: "http"`.
2. MCP `initialize` on the session endpoint (protocol `2025-03-26`) → 200 SSE,
   `serverInfo: {name: "mcp-typescript server on vercel"}`, capabilities `{tools: {listChanged: true}}`.
3. MCP `tools/list` on the session endpoint → the session meta-tools (exact names in §4).
4. MCP `tools/call` `COMPOSIO_SEARCH_TOOLS` `{query: "search hacker news"}` → found
   `HACKERNEWS_SEARCH_POSTS` (+ related item tools) in the `hackernews` toolkit
   (no-auth toolkit; execution worked without any connected account — see §7).
5. MCP `tools/call` `COMPOSIO_MULTI_EXECUTE_TOOL` with
   `{tools: [{tool_slug: "HACKERNEWS_SEARCH_POSTS", arguments: {query: "model context
   protocol", size: 3}}]}` → `successful: true`, first `response.successful: true`,
   `hits` non-empty (real public Hacker News story records, Algolia full-text search).
6. Negative: invalid `x-api-key` on the session MCP `initialize` → **HTTP 401** (fail-closed;
   no protocol response). Invalid key on the REST session factory → **HTTP 401**.
   Unknown session id in the MCP URL → **HTTP 404** with JSON error
   (`Tool router session with ID ... not found`, code 4331).

## 3. Exact API / MCP server / tool names

- REST session factory: `POST https://backend.composio.dev/api/v3.1/tool_router/session`
- Hosted session MCP URL pattern: `https://backend.composio.dev/tool_router/<session_id>/mcp`
- Session meta-tools observed via `tools/list` (exact names):
  `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`,
  `COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_REMOTE_WORKBENCH`, `COMPOSIO_REMOTE_BASH_TOOL`
  (session create also returns this list in `tool_router_tools`).
- Executed target tool (read-only, no-auth toolkit `hackernews`): `HACKERNEWS_SEARCH_POSTS`
  (search Hacker News posts via Algolia), executed through `COMPOSIO_MULTI_EXECUTE_TOOL`
  with `{tools: [{tool_slug, arguments}], thought}`.
- Capability mapping (declared in `packages/mos-capabilities/src/contract.example.ts`):
  capability `research.discussion.search`, implementation
  `impl-composio-discussion-search`, operation mapping = `COMPOSIO_MULTI_EXECUTE_TOOL` →
  `HACKERNEWS_SEARCH_POSTS`.

## 4. Tool mapping verification

- Descriptor `toolMappingVerified: true` (provider descriptor
  `packages/mos-integrations/src/contract/composio-descriptor.ts`) is backed by:
  1. live `tools/list` enumeration confirming the exact meta-tool names (§2.3), and
  2. one executed real read through `COMPOSIO_MULTI_EXECUTE_TOOL` (§2.5/§7).
- Capability descriptor `toolMapping: {toolName: "COMPOSIO_MULTI_EXECUTE_TOOL", verified: true,
  verifiedAt: 2026-11-13T00:00:00Z}` — the observed tool name matches the declared name.

## 5. Account type and tenant eligibility

- Account form: Composio project API key (`x-api-key`), project-scoped. No OAuth client,
  no app review, no per-user authorization for the no-auth `hackernews` toolkit.
- Scope requirements for the executed read: none (no-auth toolkit; `requiredScopes: []`).
- Rate limits (documented, not stress-tested): 2K–10K requests/minute plan-dependent.

## 6. Test account identity (redacted/safe form)

- Project API key supplied in-environment by the repo owner (never in repo). No personal
  data involved in the read target (public Hacker News posts; assertions record
  counts/shapes only, no payload copying into repo artifacts).

## 7. Actual request/response evidence and timestamps

- Live integration suite: `packages/zcode-mos-adapters/test/integration/composio-live-stack.test.ts`
  — 5/5 PASS at 2026-11-13 00:51:43–00:52:15 UTC (with `COMPOSIO_API_KEY` present), run
  `pnpm --filter @zcode/adapters... build && pnpm --filter @mos/adapters test`:
  1. session factory issues a real hosted MCP session (201; `trs_*`; mcp.url shape)
  2. credential chain: key round-trips the REAL encrypted ZCode credential store
     (opaque ref) and the loaded value connects the session MCP over the REAL
     `createMcpAdapter` http transport with the `x-api-key` header → status `connected`
  3. `listTools` enumerates the real session meta-tools (names in §3)
  4. one real external-data read end-to-end: `COMPOSIO_MULTI_EXECUTE_TOOL` →
     `HACKERNEWS_SEARCH_POSTS` → `successful: true`, non-empty `hits` (shapes asserted)
  5. negative matrix: invalid key on the live session endpoint → connect `failed`
     (401), no tools surfaced
- Without `COMPOSIO_API_KEY` the live suite skips (skip semantics; never fake-green).
- Correlation facts: server name `composio-session`, client `mos-integration@0.2.0`
  (createMcpAdapter), one session per test (session ids are ephemeral and not recorded).

## 8. Negative tests (contract-level matrix over the local stand-in http server)

`mcp-real-stack.test.ts` http section (stand-in streamable HTTP MCP server,
`test/fixtures/standin-http-mcp-server.mjs` — contract-level, no real provider):

- correct `x-api-key` header → `connected`, tool served, read passthrough OK
- wrong header value → 401 → status `failed`, zero tools (fail-closed)
- live negatives (real service): §2.6 — 401 invalid key (MCP + REST), 404 unknown session.

## 9. Quota / rate-limit result

- Not observed as a limit event (single read + a handful of session creates). Documented
  plan-dependent rate limits in §5. No quota assertions made beyond the single-read success.

## 10. Limitations, review status and fallback

- Verified surface: session MCP transport + the `hackernews` no-auth toolkit read path.
  OAuth-connected toolkits (Gmail/Slack/HubSpot-as-app etc.) are NOT verified — they need
  per-app user OAuth, which no MOS code path may hand-roll; the HubSpot record stays
  `blocked` until a HubSpot account exists.
- `COMPOSIO_MANAGE_CONNECTIONS` (meta-tool for user OAuth connections) is enumerated but
  intentionally NOT exercised: no user authorization journey was performed.
- Fallback: without the API key, capability resolution must treat Composio capabilities as
  `unavailable` (missing connection precondition) — resolver semantics unchanged from W1.

## 11. Reproducible test commands and exact source commit

- Branch: `w2/discovery-orchestration` (commit recorded in the Week 2 ledger section of
  `docs/handoff/IMPLEMENTATION-STATE.md`).
- Contract-level (no credentials): `pnpm --filter @zcode/adapters... build && pnpm --filter @mos/adapters test`
  (stdio + http stand-in suites; live suite skips without the env key).
- Live (requires `COMPOSIO_API_KEY` in env, never in repo):
  `COMPOSIO_API_KEY=<key> pnpm --filter @mos/adapters test`.
