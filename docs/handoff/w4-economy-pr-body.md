# Week 4 — model/engine economy and network capacity (mos-commerce + mos-resource-network)

**Branch:** `w4/economy-capacity` → `main`
**Stage:** Week 4 (architecture §12; economic model §8; backlog
`spec/backlog/week-4-economy-capacity.md`)
**Status vocabulary:** AGENTS.md §7 — both modules are **contract-tested**.

## What is in this PR (all additive; zero core ZCode files touched)

1. **Shared contracts (TL)** — `spec/contracts/core-contracts-v3.0.yaml` +
   `packages/mos-contracts/src/contract/economy.ts`: additive objects **NetworkNode**,
   **Gig** (the §8 Human Production Task Package, verbatim), **ExecutionOption**,
   **RouteComparison**, **CommerceProduct**, **PriceRecord**,
   **MarketIntelligenceRecord**; 8 new enums; 4 new invariant guards:
   - **§23 do-not-assign-people-by-default**: a gig assigned to a human node requires a
     route comparison that compared agent/engine AND no-op/reuse alternatives, none
     adequate, with evidence; `adequacy: unknown` never counts as adequate (decision
     locks #14/#17 projections).
   - **§24 append-only pricing history**: a price record's amount/model/effective window
     never change after creation; supersession appends a new record.
   - **§25 market-intelligence evidence gate**: unevidenced customer/market facts fail
     closed (no inference from briefs).
   - **§26 discovery honest surfacing**: excluded capacity (inactive nodes,
     draft/withdrawn/expired offers, deprecated/unknown engines) surfaces with named
     reasons, never silently filtered.
   82 tests (+19).
2. **`packages/mos-resource-network`** (60 tests, 5 files) — network node registration
   (upsert store, active/inactive); the Gig state machine with two fail-closed gates
   (publish = full §8 package completeness; human assignment = §23 route comparison,
   typed `GigAssignmentBlockedError` with the named missing list); pure
   `compareExecutionOptions` (recommendation order no-op/reuse > agent/engine > human;
   empty input → `no_adequate_route`, **never** default-to-human); pure
   `discoverCapacityForCapability` (matched/excluded with named reasons across nodes +
   NodeOffers + engines — the mos-engines deprecated-surfaced idiom) over injected
   `OfferLookup`/`EngineLookup` ports (mos-lab precedent — zero imports of
   agent-organizations/capabilities packages; zero provider I/O; zero executor).
3. **`packages/mos-commerce`** (39 tests, 3 files) — CommerceProduct (draft → active →
   retired); **PriceRecord append-only history** — no update API for
   amount/model/window at all; supersession = append new + retire old with a
   `superseded_by` pointer; §24 guard at every persist; same product+model active-window
   overlap → typed `PriceConflictError`; MarketIntelligenceRecord with a **double §25
   gate** (intake schema `evidence_refs` min(1) + guard at persist), opaque
   `subject_ref` (zero PII in records), facts carried verbatim (zero inference).

## Wiring

- `architecture-policy.yaml`: +2 modules (`mos-commerce`, `mos-resource-network`).
- `spec/architecture/module-registry-v3.0.yaml`: both flipped `planned` →
  `contract-tested` with dated notes.
- `scripts/engineering-test-files.json`: +10 files (232 total). **Includes a backfill**:
  W3's gate wiring omitted
  `packages/mos-contracts/test/week3-contract-schemas.test.ts` (17 tests) from the
  engineering list — it ran only in the package-local suite. Backfilled here (+17 to
  the engineering count), flagged per AGENTS.md §1 (repo documents are the authority).
- Root `package.json` typecheck chain: +`@mos/commerce` +`@mos/resource-network`.
- `pnpm-lock.yaml`: 2 new workspace importers.

## Gate evidence (run on this tree, 2026-11-14)

- `pnpm typecheck` (root, full chain incl. both new packages): every step PASS
  (environment note: this 4 GiB sandbox OOM-killed the previously recorded 3072 MB
  heap; the identical chain passes at 2560 MB per process — environment-only, same
  class as the recorded renderer-scale OOM; no repo file modified for it).
- `pnpm --filter @mos/contracts test` 82 passed; `pnpm --filter @mos/commerce test`
  39 passed; `pnpm --filter @mos/resource-network test` 60 passed.
- `pnpm lint`: 0 errors / **538 warnings — identical to the Stage 0/W1–W3/composition-root
  baseline** (3 new-code warnings found and fixed before the gate run).
- `pnpm docs:stale-phrases:check` PASS (2292 files); `pnpm db:schema:check` PASS.
- `pnpm test:architecture` PASS (61/61); `pnpm architecture:check -- --changed`
  violations 0 / baseline 0 / new 0.
- `pnpm test:engineering`: first run failed 2 files — the pre-existing
  environment-sensitive `miseToolchainEnv.test.ts` (identical to all prior baselines)
  PLUS `packages/server/test/remoteOfficialPluginAssets.test.ts` (**fresh-clone
  build-state gap**: `@zcode/contracts` exports resolve to `dist/`, which no root gate
  step builds — not caused by this branch). Corrected run after
  `pnpm --filter @zcode/contracts build` (recorded in the ledger per update rules,
  nothing deleted): **1845 passed / 1 failed (pre-existing) / 8 skipped (232 files)**.
  135 new tests since the composition-root milestone (1710 → 1845).

## Honest limits

- `OfferLookup`/`EngineLookup` composition-root wiring (studio panel/service layer)
  belongs to a later studio milestone — this stage delivers the ports and pure
  discovery over injected records.
- Unchanged blockers (hardware/account, see ledger): Desktop visual mount + desktop
  E2E, cross-client visual regression, HubSpot live read, mos-studio
  production-surface reads, marketplace copy-style plugin packaging.
- The `@zcode/contracts` dist build-state gap is flagged for a future gate-wiring
  decision; deliberately not fixed here to keep this branch additive-only.

## Rollback

Revert the merge commit — all changes are additive (2 new packages, 1 new contracts
file, appended enums/invariants/exports, gate wiring). No core ZCode file is touched;
no data migration is involved.
