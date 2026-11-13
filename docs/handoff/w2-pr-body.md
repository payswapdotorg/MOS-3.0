# Week 2 — discovery and orchestration (+ Composio live verification closing the two open Week 1 ledger items)

**Branch:** `w2/discovery-orchestration` → `main`
**Stage:** Week 2 discovery and orchestration (architecture §12; backlog
`spec/backlog/week-2-discovery-orchestration.md`, work packages `spec/backlog/week-2-work-packages.yaml`)
**Status vocabulary:** AGENTS.md §7 — W2 modules are **contract-tested**; Composio live read is
**verified**; HubSpot live read remains **blocked** (unchanged).

## What is in this PR (all additive; zero core ZCode files touched)

1. **Shared contracts (TL)** — `spec/contracts/core-contracts-v3.0.yaml` + `packages/mos-contracts`:
   additive objects AgentBody, Organization, NodeOffer (the architecture §8 service-offer
   disclosure object), ResearchNote, Hypothesis; enums offer_status / hypothesis_status /
   organization_status / agent_body_status / auth_method += `api_key`; invariant guards:
   §8 offer publish gate, hypothesis-never-carries-outcome (decision lock #18),
   simulation-never-provider-observation, tenant-scope isolation. 46 tests (25 new).
2. **`packages/mos-agent-organizations` (W2-A)** — AgentBody/Organization/NodeOffer
   tenant-scoped stores (atomic writes), fail-closed §8 offer publish gate (missing
   disclosures named in `OfferPublishBlockedError`; final guard `assertNodeOfferPublishable`),
   `listPublishedByCapability` (withdrawn/expired/draft never surface). 56 tests.
3. **`packages/mos-lab` (W2-B)** — ResearchNote verbatim intake with an injected
   evidence-lookup port (missing refs / simulation-as-provider-observation fail closed),
   HypothesisStore (decision lock #18: creation is always `proposed` with null
   `experiment_ref`; outcome vocabulary unwritable from lab), program discovery that only
   references existing route/offer records with explicit missing preconditions. Mission /
   route / offer access via structural lookup ports — no imports beyond `@mos/contracts` +
   zod + node builtins. 60 tests.
4. **Composio live verification (TL)** — closes the two open Week 1 ledger items through a
   real provider account (Composio project API key, in-environment only):
   - `ProviderServerConfig` http/sse variants accept runtime-injected `headers`
     (`packages/zcode-mos-adapters`).
   - Live suite `composio-live-stack.test.ts` (env-gated, 5/5 PASS with `COMPOSIO_API_KEY`):
     REST session factory → real encrypted credential-store round-trip → real ZCode MCP
     client http transport with the documented `x-api-key` header → `listTools` meta-tools →
     **one real external-data read** (`HACKERNEWS_SEARCH_POSTS` via `COMPOSIO_MULTI_EXECUTE_TOOL`)
     → invalid-key 401 fail-closed negative.
   - `composio-descriptor.ts` (toolMappingVerified=true, auth_method=api_key) + capability
     example resolving **available** with real evidence; full redacted evidence record at
     `spec/integrations/provider-evidence/composio-connector-evidence.md`.
   - Non-env-gated http stand-in tests keep header-passthrough coverage credential-free.
   - HubSpot ledger row unchanged (still blocked; no HubSpot account exists here).

## Gate evidence (run on this tree, 2026-11-13)

- `pnpm test:architecture` PASS (61/61); `pnpm architecture:check -- --changed` violations 0
- `pnpm typecheck` (root, incl. both new packages) PASS
- `pnpm lint` 0 errors / 538 warnings — identical to the W1/Stage 0 baseline (6 new-code
  warnings found and fixed before the gate run)
- `pnpm docs:stale-phrases:check`, `pnpm db:schema:check` PASS
- `pnpm test:engineering` 1379 passed / 1 failed / 8 skipped — the single failure is the
  pre-existing environment-sensitive `miseToolchainEnv.test.ts` (identical to Stage 0/W1
  baselines; not a regression). All 11 newly listed MOS test files passed.
- MOS package suites: contracts 46, identity-bridge 6, integrations 48, capabilities 43,
  missions 30, routes 16, agent-organizations 56, lab 60, ui mos-extension 40 — green
- `pnpm --filter @zcode/adapters... build && COMPOSIO_API_KEY=... pnpm --filter @mos/adapters test`:
  29/29 PASS (real-stack stdio/http stand-ins + 5 live tests); without the key the live
  suite skips (never fake-green)

## Rollback notes

Every change is additive (new packages, new contract objects/enums, new tests, new evidence
docs, gate wiring). Reverting the merge commit restores main exactly; no upstream file is
modified (verified via `git diff --name-only origin/main`).

## Worker records

- W2-A: `/home/z/agent-ctx/W2-A-worker-a.md` (outside the repo, per worker protocol)
- W2-B: package delivered in-tree; TL fixed 2 test-fixture mismatches after the worker hit
  its context deadline and re-verified 60/60 (noted in the Week 2 ledger record)
