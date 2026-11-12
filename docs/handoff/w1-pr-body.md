# PR: Week 1 integration foundation (MOS 3.0)

**Branch:** `w1/integration-foundation` → `main`
**Base:** `e7099a74` (Stage 0 import merge)
**Status vocabulary:** AGENTS.md §7 — everything below is **contract-tested**; live provider read is **blocked**; in-app composition/UI mounting is **deferred**.

## What this PR delivers

A pure-additive Week 1 vertical-slice foundation inside the real ZCode v3.18.0 tree. No core ZCode file is modified except the four gate-wiring files listed below. MOS does not create a second authority for tools, permissions, plugins, sessions or model routing: provider I/O goes through structurally-injected ports that the composition root will later adapt onto the existing ZCode MCP/OAuth/credential infrastructure.

### New architecture-registered modules (8)

| Module (policy id) | Package | Content | Tests |
|---|---|---|---|
| `mos-contracts` | `packages/mos-contracts` | core-contracts-v3.0.yaml as zod schemas + runtime invariant guards (§invariants enforced at write boundaries, fail-closed) | 21 |
| `zcode-mos-adapters` | `packages/zcode-mos-adapters` | ProviderPort + SessionFactsPort + TimePort (structural injection; zero CLI-subtree production imports); error classification negative matrix; real ZCode MCP client stack + real encrypted credential store exercised by package-local integration tests | 16 unit + 8 integration |
| `mos-identity-bridge` | `packages/mos-identity-bridge` | ZCode identity/workspace facts → TenantContext, fail-closed (missing user/session/workspace ⇒ structured `unavailable`) | 6 |
| `mos-integrations` | `packages/mos-integrations` | HubSpot provider descriptor (`toolMappingVerified: false`), installable connector plugin declaration (ZCode plugin manifest schema unchanged), tenant-scoped durable connection store (opaque `credential_ref` only), read adapter with redacted evidence capture | 41 |
| `mos-capabilities` | `packages/mos-capabilities` | Capability descriptor schema (provider-integration-strategy §3), catalog, fail-closed account capability instance resolver — `available` requires live connection check + full scope coverage + verified tool mapping | 41 |
| `mos-missions` | `packages/mos-missions` | Verbatim mission intake (zero inference), durable tenant-scoped store, graceful-failure sidecar linkage subscribed only to standard task-created facts; any MOS failure leaves the ZCode task path untouched | 30 |
| `mos-routes` | `packages/mos-routes` | existing / conditional / blocked / unknown route evaluation, exact-precondition disclosure, no silent fallback | 16 |
| `mos-extension` | `packages/ui/src/mos-extension` | Fail-closed availability flag, sidecar store, status chip (`TID_MOS_STATUS_CHIP`), registration seam — implemented + tested, **not mounted** (composition deferred) | 40 |

### Gate wiring (the only modified pre-existing files)

1. `architecture-policy.yaml` — 8 managed module registrations (`requires` verified against each `module.ts`; `architecture:check -- --changed` ⇒ **0 violations**)
2. `scripts/engineering-test-files.json` — +19 MOS test files (portable node-env tests only; the 8 dist-dependent real-stack integration tests stay package-local per repo precedent, runnable via `pnpm --filter @mos/adapters test`)
3. `package.json` — `typecheck` script extended with the 7 MOS package typechecks
4. `spec/architecture/module-registry-v3.0.yaml` — week-1 module statuses → `contract-tested`; id-mapping note (`zcode-substrate-adapters` ⇔ governance id `zcode-mos-adapters`)

Plus new docs: `spec/integrations/provider-evidence/hubspot-connector-evidence.md`, `docs/handoff/w1-pr-body.md` (this file), IMPLEMENTATION-STATE.md Week 1 record. `pnpm-lock.yaml` updated for the new workspace packages.

## Gate evidence (final tree)

- `pnpm test:architecture` — PASS
- `pnpm architecture:check -- --changed` — violations 0 / new 0
- Per-package suites — all green (counts above; `pnpm --filter <pkg> test`)
- `pnpm typecheck` — PASS (on ≤4 GiB sandboxes set `NODE_OPTIONS=--max-old-space-size=3072` for the `tsc -b` chain; environment note, not a source deviation)
- `pnpm lint` — 0 errors, 538 warnings, all pre-existing (identical count to Stage 0 baseline)
- `pnpm test:engineering` — see IMPLEMENTATION-STATE.md for the appended run record
- `pnpm docs:stale-phrases:check`, `pnpm db:schema:check` — PASS
- Real-stack integration (package-local): `pnpm --filter @zcode/adapters... build && pnpm --filter @mos/adapters test` — 8/8 PASS (stand-in stdio MCP server over the real `createMcpAdapter` client + real `createSharedZCodeCredentialStore`, secrets encrypted at rest, verified not present in plaintext)

## Provider evidence (honest state)

- Live observations, re-verified 2026-11-12 UTC: `https://mcp.hubspot.com/.well-known/oauth-authorization-server` → HTTP 200; `https://mcp.hubspot.com/.well-known/oauth-protected-resource` → `{"resource":"https://mcp.hubspot.com","authorization_servers":["https://mcp.hubspot.com"],"scopes_supported":[],"resource_documentation":"https://developers.hubspot.com/mcp"}`
- Exact HubSpot MCP tool names and scope bindings: **UNVERIFIED** — no provider account/OAuth client exists in this environment. The capability resolver is fail-closed: instances remain `unavailable` / support `unknown` until the live server's tool catalog is recorded and the descriptor mapping is verified.
- No mock is presented as a live read; all provider evidence in this PR is labeled contract-level (stand-in stdio server over the real ZCode MCP client + real credential store).

## Out of scope / deferred (per Week 1 backlog)

- In-app composition (mounting sidecar + UI chip into the running app) — requires composition-root path ownership and renderer verification; renderer vite builds OOM on this 3.9–4.1 GiB sandbox (Stage 0 deviation, unchanged).
- Live HubSpot read + negative matrix against the real endpoint — **blocked** on provider account provisioning; the live-verification plan is written in the evidence record.
- App-level feature flag plumbing, i18n hookup of the status chip, browser/desktop E2E — deferred with composition.

## Rollback

Single branch revert (`git revert -m 1` of the merge, or delete the branch). The only shared-state changes are the four gate-wiring files; every MOS package is self-contained under `packages/mos-*` / `packages/ui/src/mos-extension`, no runtime behavior of the existing ZCode app changes without the (deferred) composition step.

## Lineage note

The original Week 1 implementation was completed and verified in a previous sandbox instance but could not be pushed (no GitHub credentials) and was lost when that sandbox was reset. This branch is a full rebuild from the canonical repository documents (AGENTS.md, spec/**, docs/handoff/**) as the sole authority; all gate evidence in this PR was re-run on this tree and is reproducible from the commands above.
