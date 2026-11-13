# Week 3 — transformations and artifact lineage (+ distribution, experiments, learning)

**Branch:** `w3/transformations-artifacts` → `main`
**Stage:** Week 3 (architecture §12; backlog `spec/backlog/week-3-transformations-artifacts.md`,
work packages `spec/backlog/week-3-work-packages.yaml`)
**Status vocabulary:** AGENTS.md §7 — seven modules are **contract-tested**; **mos-studio is
deferred** (composition-root ownership blocker from Week 1, recorded in the module registry
with an explicit note).

## What is in this PR (all additive; zero core ZCode files touched)

1. **Shared contracts (TL)** — `spec/contracts/core-contracts-v3.0.yaml` +
   `packages/mos-contracts`: additive objects Transform, Engine, ProductionGraph,
   ProductionJob, RightsRecord, DistributionIntent, Experiment, CalibrationRecord; 10 new
   enums; 6 new invariant guards (rights gate fail-closed; no-second-executor per decision
   lock #5; graph engine refs opaque per lock #9; experiment outcome evidence per lock #18;
   distribution preview+approval; calibration delayed-mode). 63 tests.
2. **`packages/mos-content-artifacts` (W3-A)** — immutable versioned artifact chain
   (lineage enforced via `assertArtifactVersionLineage`), opaque `content_ref` only,
   tenant-scoped atomic store. 31 tests.
3. **`packages/mos-rights-policy` (W3-A)** — fail-closed rights gate with named deny
   reasons; wildcard (platform-policy) coverage semantics; append-only review decisions. 35 tests.
4. **`packages/mos-engines` (W3-B)** — engine registry, capability matching (deprecated
   engines surfaced with reason, never hidden), sandbox policy descriptors; **zero
   invocation code** (decision lock #9). 39 tests.
5. **`packages/mos-production` (W3-B)** — transform registry; DAG graph validation with
   named errors (cycles/orphans/unresolved refs/retired transforms/deprecated engines);
   durable job state with external `zcode_execution_ref` only — **zero executor**
   (decision lock #5). 81 tests.
6. **`packages/mos-distribution` (W3-C)** — intent state machine; executing/succeeded
   require an approved preview binding (`assertDistributionPreviewApproval`); idempotency
   conflicts; execution records are evidence refs only — **zero provider I/O**. 39 tests.
7. **`packages/mos-experiments` (W3-C)** — the Experiment authority of decision lock #18:
   outcomes writable only through `conclude()` with measurement evidence; hypothesis
   adoption via a structural `HypothesisUpdatePort` (composition root maps it to
   `@mos/lab` saveHypothesis — the write right W2 reserved for W3). 35 tests.
8. **`packages/mos-learning` (TL)** — calibration records only from concluded experiments
   with evidence (structural lookup port); `delayed_mode` locked `z.literal(true)`; a
   surface test asserts the package exposes **zero** route/production mutation APIs. 14 tests.

**mos-studio:** stays `planned` with an explicit registry deferral note — its human-facing
surface depends on the composition-root ownership decision blocking in-app UI mounting
since Week 1; the domain seams it needs are delivered by this week's modules.

## Gate evidence (run on this tree, 2026-11-13)

- `pnpm test:architecture` PASS (0 fail); `pnpm architecture:check -- --changed` violations 0
- `pnpm typecheck` (root, incl. all 7 new packages) PASS
- `pnpm lint` 0 errors / 538 warnings — identical to the Stage 0/W1/W2 baseline (6
  new-code warnings found and fixed before the gate run)
- `pnpm docs:stale-phrases:check`, `pnpm db:schema:check` PASS
- `pnpm test:engineering` 1653 passed / 1 failed / 8 skipped — the single failure is the
  pre-existing environment-sensitive `miseToolchainEnv.test.ts` (identical to all prior
  baselines; not a regression). All 16 newly listed W3 test files passed (+274 MOS tests
  since Week 2).
- MOS package suites (16): all green — see the Week 3 ledger record for counts.

## Rollback notes

Every change is additive (new packages, new contract objects/enums, new tests, gate
wiring). Reverting the merge commit restores main exactly; no upstream file is modified.

## Worker records

W3-A/W3-B/W3-C worker report-backs hit infrastructure timeouts after delivering to the
tree; the TL verified all work in-tree (typecheck + full test suites per package) and
fixed post-delivery defects (import paths, one additive enum value `cancelled`, two test
expectation corrections) — all listed per package in the Week 3 ledger record.
