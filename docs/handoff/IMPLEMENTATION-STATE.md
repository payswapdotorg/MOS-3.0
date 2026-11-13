# MOS 3.0 implementation state

**Last verified:** 2026-11-14 Week 4 economy/capacity (branch `w4/economy-capacity`; composition-root milestone merged to main at 8834b35e — see Week 4 record)
**Repository:** payswapdotorg/MOS-3.0
**Main bootstrap commit:** e3c0fa0e2f477988441d283428b259c6409180f6
**ZCode v3.18.0 import merge commit:** 545910f3ecf4ebc149c690c3bb7b77124e1e747e (two-parent merge of MOS main base 3a1f50b + upstream pin b95ebaff)

## Current posture

- [x] Repository exists and is writable by connected GitHub identity.
- [x] Product and architecture bootstrap documents committed.
- [x] Full ZCode source tree imported. (merge 545910f3 on `bootstrap/import-zcode-v3.18.0`; all 18,657 upstream pin files retained; 18,675 tracked files at the merge tree)
- [x] Upstream remote, fork point and preservation inventory recorded. (upstream remote + `upstream/main` tracking; tag `mos3-zcode-v3.18.0`; takeover record in `spec/architecture/source-baselines.yaml`; inventory in `docs/handoff/PRESERVATION-INVENTORY-v3.18.0.md`; SHA-256 manifest `docs/upstream/source-inventory-sha256-import-v3.18.0.txt` = `13c2c2a8345cb48defb8e88783d7ae29e164bf3285498788af4c62f6cffa91ac`)
- [x] Upstream build/test baseline established and recorded. (typecheck, lint, architecture governance, db schema, doc checks and 1018 engineering tests PASS; renderer-scale builds **re-verified on adequate hardware 2026-11-12**, see adequate-hardware record below; desktop E2E still pending — needs a display/docker environment)
- [x] Week 1 capability/adapter code implemented. (branch w1/integration-foundation; 8 modules registered in architecture-policy.yaml; contract-tested per package suites)
- [x] Real provider account connected. (2026-11-13: provider=composio, project API key + hosted session MCP; see Week 2 record)
- [x] Real provider read operation verified. (2026-11-13: one real external-data read — HACKERNEWS_SEARCH_POSTS via COMPOSIO_MULTI_EXECUTE_TOOL over the real ZCode MCP client http transport + real encrypted credential store; evidence spec/integrations/provider-evidence/composio-connector-evidence.md)
- [x] MOS mission sidecar linkage implemented and contract-tested (observeTaskCreated-based, graceful failure). In-app composition delivered by the composition-root milestone (mos-studio ZCode plugin: SessionStart hook → mission sidecar; journey evidence in the milestone record below); Desktop visual mount + desktop E2E remain blocked on hardware.
- [x] Existing/conditional/blocked/unknown route evaluation implemented and contract-tested (fail-closed; no silent fallback).
- [x] New Task preservation verified structurally (zero core file edits; upstream task path untouched; hook onError:allow + always exit 0) and journey-tested end-to-end at the plugin/CLI-runtime level (real SessionStart payload → mission; real-stack + live Composio evidence in the milestone record). Cross-client (Desktop/Web visual) regression remains hardware-blocked (no docker/display).
- [x] Week 2 discovery/orchestration modules implemented and contract-tested (mos-agent-organizations 56 tests, mos-lab 60 tests; see Week 2 record).
- [x] Week 3 transformation/artifact-lineage modules implemented and contract-tested (7 packages, 274 new tests; mos-studio deferred — composition blocker; see Week 3 record).
- [x] Composition-root milestone delivered (mos-studio plugin: New Task → Mission → capabilities → routes → authorized read; see composition-root milestone record).
- [x] Week 4 economy/capacity modules implemented and contract-tested (mos-commerce + mos-resource-network, architecture §8 invariants §23–§26; see Week 4 record).

## Evidence ledger

| Item | Status | Evidence / blocker |
|---|---|---|
| MOS repository bootstrap | scaffolded | Initial commit e3c0fa0e2f477988441d283428b259c6409180f6 |
| ZCode upstream pin | verified | v3.18.0 commit b95ebaffeab641907b38652f45c1502bd762972d; upstream main HEAD == pin at import time (2026-11-12) |
| MOS-2.0 domain architecture reference | verified as reference | MOS-2.0 v2.0 architecture; old substrate was ZCode v3.14.3 |
| ZCode code import | imported (Stage 0) | Merge commit 545910f3ecf4ebc149c690c3bb7b77124e1e747e; parents 3a1f50b (MOS main) + b95ebaff (pin); only conflicts were README.md/AGENTS.md, upstream copies preserved at docs/upstream/; 18,675-file SHA-256 manifest 13c2c2a8345cb48defb8e88783d7ae29e164bf3285498788af4c62f6cffa91ac |
| Upstream build/test baseline | recorded + renderer builds re-verified | typecheck / lint / test:architecture / db:schema:check / docs:stale-phrases:check / 1018 engineering tests PASS (local 4.1GiB sandbox); renderer-scale `pnpm build:bootstrap` **PASS on a 4 vCPU / 8 GiB cloud fresh clone** (2026-11-12 23:32 UTC, adequate-hardware record below) — the local OOM was environment-only, as suspected; desktop E2E still pending (needs display/docker) |
| Live provider integration | verified (provider=composio) | Composio project API key (in-environment only, never in repo) + hosted session MCP transport; W2 record below. HubSpot remains blocked (no account) |
| HubSpot live read | blocked | No HubSpot account/OAuth client in this environment; HubSpot descriptor stays toolMappingVerified=false; its live-verification plan is unchanged |
| Week 1 domain/adapter code | contract-tested | 8 packages on w1/integration-foundation: mos-contracts 21 tests, zcode-mos-adapters 16 unit + 8 real-stack integration, mos-identity-bridge 6, mos-integrations 41, mos-capabilities 41, mos-missions 30, mos-routes 16, ui mos-extension 40; per-package suites green (`pnpm --filter <pkg> test`) |
| Real-stack MCP/credential integration tests | contract-tested | packages/zcode-mos-adapters/test/integration/mcp-real-stack.test.ts: stand-in stdio MCP server over the REAL ZCode MCP client (createMcpAdapter) + REAL encrypted credential store (createSharedZCodeCredentialStore); requires `pnpm --filter @zcode/adapters... build` first; NOT in engineering list (dist dependency), matches repo precedent for apps/zcode-cli package-local tests |
| HubSpot provider evidence | recorded + re-verified | spec/integrations/provider-evidence/hubspot-connector-evidence.md; live observations 2026-11-12 UTC: mcp.hubspot.com OAuth protected-resource + authorization-server discovery both HTTP 200; exact tool names/scope bindings UNVERIFIED (no provider account) — capability resolver fail-closed until verified |
| Live provider read | blocked | No HubSpot account/OAuth client in this environment; live-verification plan recorded in the evidence record |
| In-app composition + UI mounting | delivered (composition-root milestone) | mos-studio ZCode plugin (`ui.surfaces` + top-level `slots` nav.primary/sidePane.launcher + SessionStart hook); inline plugin via `plugins.dirs` (defaultEnabled). Desktop renders the MCP Apps panel; Web/remote degrade to plain tool records (upstream fallback). Real discovery/loader validation + real-stack journey + live Composio read in the milestone record below; Desktop visual mount + desktop E2E remain blocked (no docker/display) |
| Product behavior | preserved, not yet exercised | Import adds no ZCode behavior changes; only MOS docs, preserved upstream doc copies and import evidence were added |

## Update rules

Only update status when commit, test, API/runtime and relevant user journey evidence exist. Add evidence URLs/commit hashes and observed time. Keep blocked/deferred states visible. Do not delete failed test evidence; append corrected runs and explain the change.

## Week 1 record (branch w1/integration-foundation, 2026-11-12)

**Environment incident (recorded for lineage honesty):** the original Week 1 implementation
(5+1 commits on a previous sandbox clone) was completed and gate-verified on 2026-11-12, but
`git push` was blocked by the absence of GitHub credentials in that environment, and the sandbox
was subsequently reset, destroying the unpushed local clone. The branch was therefore REBUILT on
this clone from the canonical repository documents (AGENTS.md, spec/**, docs/handoff/*) as the
sole authority; package structure, module ids and gate wiring follow the architecture registry.
Nothing in this record depends on chat memory or the lost tree; all status below is re-verified
on the current tree.

**Rebuilt deliverable:** 8 architecture-registered modules, all additive; zero core ZCode files
touched (verified by `git diff --name-only origin/main` — changes outside packages/mos-*, ui
mos-extension, provider-evidence and gate wiring are limited to those listed below).

- `packages/mos-contracts` — core-contracts-v3.0.yaml as zod schemas + runtime invariant guards (21 tests)
- `packages/zcode-mos-adapters` — provider + session substrate ports, structural injection (no CLI-subtree production imports); real ZCode MCP stack exercised by package-local integration tests (16 unit + 8 integration)
- `packages/mos-identity-bridge` — ZCode identity/workspace facts to TenantContext, fail-closed (6 tests)
- `packages/mos-integrations` — HubSpot descriptor, installable connector plugin declaration, tenant-scoped connection store (opaque credential_ref only), read adapter with negative-matrix error classification, redacted provider evidence (41 tests)
- `packages/mos-capabilities` — capability descriptor schema (strategy §3), catalog, fail-closed account capability instance resolver; available requires live check + scopes + verified tool mapping (41 tests)
- `packages/mos-missions` — verbatim mission intake (zero inference), durable tenant-scoped store, graceful-failure sidecar linkage after standard task creation (30 tests)
- `packages/mos-routes` — existing/conditional/blocked/unknown route evaluation, fail-closed, no silent fallback (16 tests)
- `packages/ui/src/mos-extension` — fail-closed availability flag, sidecar store, status chip, registration seam; implemented + tested, NOT mounted (composition deferred) (40 tests)

**Gate wiring (modified files, complete list):**
`architecture-policy.yaml` (8 module registrations),
`scripts/engineering-test-files.json` (+19 MOS test files; dist-dependent integration tests excluded by repo precedent),
`package.json` (typecheck script extended with the 7 MOS package typechecks),
`spec/architecture/module-registry-v3.0.yaml` (week-1 module statuses + id-mapping note),
`docs/handoff/IMPLEMENTATION-STATE.md` (this record),
plus NEW files: `docs/handoff/w1-pr-body.md`, `spec/integrations/provider-evidence/hubspot-connector-evidence.md`,
and the 8 packages above. `pnpm-lock.yaml` updated for the new workspace packages.

**Gate evidence (run on this tree, 2026-11-12):**
- `pnpm test:architecture`: PASS (0 fail)
- `pnpm architecture:check -- --changed`: violations 0, new 0
- MOS package suites (per package): all green, counts above
- `pnpm typecheck`: PASS — note: on a 3.9 GiB sandbox the `tsc -b` chain requires `NODE_OPTIONS=--max-old-space-size=3072` (default 2 GiB heap cap aborts); environment note, not a source deviation
- `pnpm lint`: 0 errors, 538 warnings (identical to Stage 0 baseline; 0 new)
- `pnpm docs:stale-phrases:check` + `pnpm db:schema:check`: PASS
- `pnpm test:engineering`: 1229 passed / 1 failed / 8 skipped (1238 total; 185 files passed). The single failure is the pre-existing environment-sensitive `packages/desktop/test/miseToolchainEnv.test.ts` (sandbox node at /usr/bin), identical to the Stage 0 baseline — not a regression. All 19 newly listed MOS test files passed (211 MOS tests).
- `pnpm --filter @mos/adapters test` (real-stack integration): 8/8 PASS (requires `pnpm --filter @zcode/adapters... build` first)
- `git push -u origin w1/integration-foundation`: DONE — pushed 2026-11-12 22:39 UTC, PR #2 opened; see publication record below

**Publication record (2026-11-12 22:39 UTC):**

- `git push -u origin w1/integration-foundation` succeeded (first push of this branch; GitHub identity `payswapdotorg`, PAT supplied in-environment). Pre-push gate `verify:pre-push` fully green during the push: worktree check, e2e remote targets, lint (0 errors / 538 pre-existing warnings), docs:stale-phrases:check, db:schema:check, test:architecture (61/61), architecture:check --changed (violations 0 / baseline 0 / new 0).
- `test:engineering:affected --scope push` environment note: the script's default first-push baseline `origin/staging` does not exist on this fork's remote (remote has only `main` and `bootstrap/import-zcode-v3.18.0`); the caller-specified baseline `ZCODE_PRE_PUSH_BASE=origin/main` (the actual merge-base e7099a74 of this branch) was used, per the script's supported override (`scripts/engineering-tests/scope.mjs`, explicit-base precedence). Vitest official selection chose the entire 188-spec engineering suite, and per the script's full-selection rule the run was skipped without blocking the push; the full-suite result is recorded above (1229 passed / 1 pre-existing environment failure / 8 skipped). No repository file was modified for this override.
- PR #2 opened: https://github.com/payswapdotorg/MOS-3.0/pull/2 (head `w1/integration-foundation` → base `main`; 5 commits, 138 changed files; body from `docs/handoff/w1-pr-body.md`). No CI workflows exist in this repository, so the pre-push gate evidence above and in the PR body is the verification record.
- Credentials handling: all supplied secrets are stored only outside the repository (`~/.git-credentials`, `~/.mos-secrets.env`, mode 0600, sourced from `~/.bashrc`); no secret is present in any commit of this branch.
- **PR #2 MERGED to main**: merge commit `0601ef0043b0aaa1ce9cf48c285c4b1920009338` (parents `e7099a74` main + `0d7ecf4e` branch head), merged via GitHub API (merge method: merge commit, consistent with PR #1) at 2026-11-12 22:48:57 UTC. Local main synced to `0601ef00`, worktree clean. Week 1 code is now the canonical main.
- Remaining open Week 1 items after the adequate-hardware run: real provider read (no provider account/OAuth client yet) and desktop E2E (needs a display/docker environment). Renderer-scale builds are re-verified — see the adequate-hardware record below.

**PR #3 (fresh-clone typecheck fix) merged to main:** merge commit `b0d9ac0ecbb06b4f25ddf1017f822f95293c1fc1` (parents `426e5ed5` main + `04d6a35e` fix), merged via GitHub API at 2026-11-12 ~23:35 UTC. Fix commit `04d6a35ea53612f7c7be281b224582c02f91cf91`.

**Adequate-hardware re-verification record (2026-11-12 23:28–23:32 UTC):**

- Environment: Daytona cloud sandbox `mos-build-verify` (snapshot `daytona-large`; cgroup limits 4 vCPU / 8 GiB RAM / 10 GB disk), node v24.22.1, pnpm 10.33.2, fresh `git clone --depth=1` of `main` (HEAD `426e5ed5`) + fix commit `04d6a35e` checked out. Cloud credentials are stored outside the repository (`~/.mos-secrets.env`, mode 0600).
- Environment workarounds (network, not source): the sandbox egress only reaches GitHub domains, so the Electron binary download used `ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/` (honored by `packages/desktop/scripts/ensure-electron-runtime.mjs`), and the Electron node-headers tarball for the `node-pty` electron-rebuild (`https://www.electronjs.org/headers/v44.7.0/node-v44.7.0-headers.tar.gz`, unreachable from the sandbox) was downloaded in a reachable environment, checksum-verified against the official `SHASUMS256.txt` (sha256 `bb2b300b13850a976343a506c05aad5716bda0c43511add122ecd1959383ddd0`) and pre-seeded into `~/.electron-gyp/44.7.0` and `~/.electron-gyp/_p/node-pty/44.7.0` with `installVersion=11` (node-gyp `--ensure` then skips the download). No repository file was modified for these workarounds.
- **Defect found by the fresh clone and fixed (PR #3):** root `pnpm typecheck` on a fresh clone FAILED at `@mos/adapters` — `packages/zcode-mos-adapters` typecheck included `test/integration/mcp-real-stack.test.ts`, which imports `@zcode/adapters`/`@zcode/contracts` whose types resolve to `apps/zcode-cli/packages/*/dist/*.d.ts` build artifacts; the root chain runs package typechecks before any build outputs exist, and local dev trees had passed only because build artifacts were already present. Fix: exclude `test/integration` from the package typecheck (fresh-clone safe) and add package-local `typecheck:integration` (`tsconfig.integration.json`) with the documented `pnpm --filter @zcode/adapters... build` precondition — the same precedent the repo already applies to dist-dependent tests.
- Fresh-clone results on the fixed tree (`04d6a35e`, `apps/zcode-cli/packages/adapters/dist` probed absent before the run):
  1. `pnpm install --frozen-lockfile` — **PASS** (with the two network workarounds above; also passed locally at Stage 0/Week 1)
  2. `pnpm typecheck` (root, full chain incl. all 7 MOS package typechecks) — **PASS** (112 s)
  3. `pnpm build:bootstrap` (all `packages/*` builds + `@zcode/desktop` `build:no-runtime-assets`, incl. desktop main/preload/host/scheduler/extension-host entries and the web renderer) — **PASS** — this is the renderer-scale chain that SIGKILL-OOMs on the 4.1 GiB local sandbox; the Stage 0 deviation is now re-verified as environment-only
  4. `pnpm --filter @zcode/adapters... build` — **PASS** (documented precondition for the real-stack integration tests)
  5. `pnpm --filter @mos/adapters typecheck:integration` — **PASS** (5 s)
  6. `pnpm --filter @mos/adapters test` — **PASS** (real-stack integration suite: stand-in stdio MCP server over the real ZCode MCP client + real encrypted credential store; 8/8, 23.3 s)
- Local re-verification after the fix (dev tree, dist present): `pnpm --filter @mos/adapters typecheck` PASS, `typecheck:integration` PASS, root `pnpm typecheck` PASS (with `NODE_OPTIONS=--max-old-space-size=3072`, unchanged local constraint); exclusion semantics verified via `tsc --listFiles` (0 integration files in the base config, 1 in the integration config).
- Resource notes for repeat runs: install+build consumed ~9.5 GB of the 10 GB disk (95%) — use a larger disk; peak memory fit comfortably in 8 GiB with `NODE_OPTIONS=--max-old-space-size=6144`.

## Week 2 record (branch w2/discovery-orchestration, 2026-11-13)

**Stage:** Week 2 discovery and orchestration (architecture §12; backlog
spec/backlog/week-2-discovery-orchestration.md, work packages spec/backlog/week-2-work-packages.yaml).
Workstreams: W2-A (worker-a, mos-agent-organizations) + W2-B (worker-b, mos-lab) + TL-W2
(shared contracts, Composio live verification, gates, publication). Worker record:
/home/z/agent-ctx/W2-A-worker-a.md (outside the repo).

**Deliverables (all additive; zero core ZCode files touched; `git diff --name-only origin/main`
confirms changes are limited to the paths listed in the work packages):**

- `packages/mos-contracts` (TL): additive core-contract extension — AgentBody, Organization,
  NodeOffer (§8 disclosure object), ResearchNote, Hypothesis schemas + enums (offer_status,
  hypothesis_status, organization_status, agent_body_status, auth_method += api_key) +
  invariant guards (offer publish gate, hypothesis-no-outcome per decision lock #18,
  simulation-not-provider-observation, tenant-scope isolation). Spec yaml extended additively
  (spec/contracts/core-contracts-v3.0.yaml). 46 tests (25 new).
- `packages/mos-agent-organizations` (W2-A): AgentBody/Organization/NodeOffer tenant-scoped
  stores (atomic JSON writes), §8 fail-closed offer publish gate (missing disclosures named,
  OfferPublishBlockedError, final guard assertNodeOfferPublishable), listPublishedByCapability.
  56 tests. module.ts requires=[mos-contracts]; registry depends_on mos-capabilities satisfied
  via opaque capability-id strings (deviation recorded in module.ts/CONTRACT.md).
- `packages/mos-lab` (W2-B): ResearchNote verbatim intake with evidence-lookup port
  (assertResearchFindingEvidence: missing refs + simulation-as-provider-observation fail
  closed), HypothesisStore (decision lock #18: creation always proposed/null experiment_ref;
  outcome vocabulary unwritable from lab), program discovery referencing existing route/offer
  records only, missing preconditions explicit. Structural lookup ports; zero imports beyond
  @mos/contracts + zod + node builtins. 60 tests (TL fixed 2 test-fixture mismatches after
  worker context deadline; re-verified 60/60).
- `packages/zcode-mos-adapters` (TL): ProviderServerConfig http/sse variants accept injected
  `headers` (authorization material; runtime-injected only, never in source/logs/persisted
  config); local stand-in http MCP server tests (header passthrough + 401 negative) in
  mcp-real-stack.test.ts (10 tests); live suite composio-live-stack.test.ts (env-gated).
- `packages/mos-integrations` (TL): composio-descriptor (toolMappingVerified=true backed by
  live observation; auth_method=api_key; session factory request/response schemas) + 7 tests
  (48 package total).
- `packages/mos-capabilities` (TL): Composio capability example (verified mapping + real
  evidence → resolves available; contrast with HubSpot unknown/unavailable) + 2 tests
  (43 package total).
- Evidence: spec/integrations/provider-evidence/composio-connector-evidence.md (live
  observation record, redacted; key material only in env + real encrypted credential store).

**Composio live verification (closes the two open W1 ledger items, 2026-11-13 00:51–00:53 UTC):**

- Live suite 5/5 PASS with COMPOSIO_API_KEY present (`pnpm --filter @zcode/adapters... build`
  then `COMPOSIO_API_KEY=... pnpm --filter @mos/adapters test`); skips without the key:
  1. REST session factory (POST /api/v3.1/tool_router/session, mcp:true, toolkits scoped to
     the no-auth hackernews toolkit) → 201, session_id, hosted mcp.url
  2. key round-trips the REAL encrypted ZCode credential store (opaque ref) and the loaded
     value connects the session MCP over the REAL createMcpAdapter http transport with the
     x-api-key header → connected
  3. listTools enumerates the real session meta-tools (COMPOSIO_SEARCH_TOOLS,
     COMPOSIO_GET_TOOL_SCHEMAS, COMPOSIO_MULTI_EXECUTE_TOOL, ...)
  4. one real external-data read end-to-end: COMPOSIO_MULTI_EXECUTE_TOOL →
     HACKERNEWS_SEARCH_POSTS → successful:true, non-empty hits (shapes asserted; no payload
     copying into repo artifacts)
  5. negative matrix: invalid key → 401 → connect failed, zero tools (fail-closed); live
     negatives also probed on REST (401) and unknown session id (404)
- HubSpot remains blocked (no HubSpot account/OAuth client); nothing in the Composio record
  changes the HubSpot record or claims HubSpot capability.
- Credential discipline: COMPOSIO_API_KEY exists only in the environment
  (~/.mos-secrets.env, mode 0600, outside the repo) and transiently in the real encrypted
  credential store during tests; never in source, tests, logs, evidence, or any commit.

**Gate wiring:** architecture-policy.yaml (+2 module registrations),
scripts/engineering-test-files.json (+11 files, 199 total), package.json typecheck chain
(+@mos/agent-organizations, +@mos/lab), module-registry-v3.0.yaml (W2 statuses
contract-tested + notes).

**Gate evidence (run on this tree, 2026-11-13):**

- `pnpm test:architecture`: PASS (61/61, 0 fail)
- `pnpm architecture:check -- --changed`: violations 0 / baseline 0 / new 0
- `pnpm typecheck` (root, full chain incl. both new packages): PASS
  (NODE_OPTIONS=--max-old-space-size=3072, unchanged local 4.1 GiB constraint)
- `pnpm lint`: 0 errors / 538 warnings — identical to the Stage 0/W1 baseline (0 new; 6
  new-code warnings found and fixed before the gate run)
- `pnpm docs:stale-phrases:check` + `pnpm db:schema:check`: PASS
- `pnpm test:engineering`: 1379 passed / 1 failed / 8 skipped (199 files) — the single
  failure is the pre-existing environment-sensitive miseToolchainEnv.test.ts (sandbox node
  at /usr/bin), identical to Stage 0/W1 baselines — not a regression. All 11 newly listed
  MOS test files passed (150 new MOS tests since W1: 1229 → 1379)
- MOS package suites: mos-contracts 46, mos-identity-bridge 6, mos-integrations 48,
  mos-capabilities 43, mos-missions 30, mos-routes 16, mos-agent-organizations 56,
  mos-lab 60, ui mos-extension 40 — all green
- `pnpm --filter @mos/adapters test` (real-stack + live): 29/29 PASS with the key present
  (8 real-stack stdio + 2 http stand-in + 5 live + 16 unit); live suite skips without it

**Publication record (2026-11-13, ~02:20 UTC):**

- `git push -u origin w3/transformations-artifacts` succeeded (GitHub identity
  `payswapdotorg`; credentials only outside the repo). Pre-push gate `verify:pre-push`
  fully green during the push: worktree check, e2e remote targets, lint (0 errors / 538
  baseline warnings), docs:stale-phrases:check, db:schema:check, test:architecture (0
  fail), architecture:check --changed (violations 0 / baseline 0 / new 0).
  `test:engineering:affected --scope push` used `ZCODE_PRE_PUSH_BASE=origin/main`
  (supported override; same as W1/W2); full-suite result recorded above.
- One pre-push worktree rejection fixed before the successful push: the additive
  `experiment_status += cancelled` spec edit had been left uncommitted (worktree check
  fail-closed as designed); committed as its own spec commit and re-pushed.
- **PR #5 opened**: https://github.com/payswapdotorg/MOS-3.0/pull/5 (head
  `w3/transformations-artifacts` -> base `main`; 6 commits, 122 changed files; body from
  `docs/handoff/w3-pr-body.md`). No CI workflows exist in this repository; the gate
  evidence above is the verification record.
- **PR #5 MERGED to main**: merge commit `10c3c95fc5d83dc8ddc20332fb28e764eb91165d`
  (merge method: merge commit, consistent with PRs #1-#4). Local main synced to
  `10c3c95f`, worktree clean. Week 3 code is the canonical main.
- Remaining open items after Week 3: mos-studio (composition-root ownership blocker),
  in-app UI composition/mounting (same blocker), New Task journey + cross-client
  regression, desktop E2E (needs display/docker), HubSpot live read (no HubSpot account),
  engine execution adapters (composition-root concern, contract-level only this week).

**Week 2 publication record (2026-11-13):**

- `git push -u origin w2/discovery-orchestration` succeeded 2026-11-13 ~01:10 UTC (GitHub
  identity `payswapdotorg`, PAT supplied in-environment; credentials only outside the repo).
  Pre-push gate `verify:pre-push` fully green during the push: worktree check, e2e remote
  targets, lint (0 errors / 538 baseline warnings), docs:stale-phrases:check, db:schema:check,
  test:architecture (61/61), architecture:check --changed (violations 0 / baseline 0 / new 0).
- `test:engineering:affected --scope push` used the caller-specified baseline
  `ZCODE_PRE_PUSH_BASE=origin/main` (same supported override as W1; fork remote has no
  origin/staging); merge-base bfec2aab selected the entire 199-spec engineering suite, and per
  the script's full-selection rule the run was skipped without blocking the push; the
  full-suite result is recorded above (1379 passed / 1 pre-existing environment failure /
  8 skipped). No repository file was modified for this override.
- **PR #4 opened**: https://github.com/payswapdotorg/MOS-3.0/pull/4 (head
  `w2/discovery-orchestration` → base `main`; 5 commits, 78 changed files; body from
  `docs/handoff/w2-pr-body.md`). No CI workflows exist in this repository, so the gate
  evidence above and in the PR body is the verification record.
- Remaining open items after Week 2: HubSpot live read (no HubSpot account/OAuth client),
  in-app UI composition/mounting (composition-root ownership), New Task journey + cross-client
  regression, desktop E2E (needs display/docker).
- **PR #4 MERGED to main**: merge commit `79437ab22d1ac07dd07573e91575bcb2fe7aacb3`
  (parents `bfec2aab` main + `b36f794e` branch head), merged via GitHub API (merge method:
  merge commit, consistent with PRs #1-#3) at 2026-11-13 ~01:15 UTC. Local main synced to
  `79437ab2`, worktree clean. Week 2 code is now the canonical main.

## Week 3 record (branch w3/transformations-artifacts, 2026-11-13)

**Stage:** Week 3 transformations and artifact lineage (architecture §12; backlog
spec/backlog/week-3-transformations-artifacts.md, work packages spec/backlog/week-3-work-packages.yaml).
Workstreams: W3-A (content-artifacts + rights-policy), W3-B (engines + production),
W3-C (distribution + experiments), TL (contracts, learning, gates, publication).
Worker report-backs hit infra timeouts; TL verified all work in-tree and fixed
post-delivery defects (listed per package) before gating.

**Deliverables (all additive; zero core ZCode files touched):**

- `packages/mos-contracts` (TL): additive objects Transform, Engine, ProductionGraph,
  ProductionJob, RightsRecord, DistributionIntent, Experiment, CalibrationRecord; enums
  (transform/engine/production graph+job/distribution statuses, rights kind+decision,
  experiment status+outcome += cancelled additive); invariant guards: rights gate
  fail-closed, no-second-executor (decision lock 5), graph engine refs opaque (lock 9),
  experiment outcome evidence (lock 18), distribution preview+approval, calibration
  delayed-mode. 63 tests (+17).
- `packages/mos-content-artifacts` (W3-A, 31 tests): immutable version chain (lineage
  enforced via assertArtifactVersionLineage), opaque content_ref only, tenant-scoped
  atomic store.
- `packages/mos-rights-policy` (W3-A, 35 tests): fail-closed rights gate with named deny
  reasons (no_covering_record/explicit_denial/decision_pending/expired), wildcard (null
  artifact ref) coverage, append-only review decisions. TL fix: one test expectation
  aligned with wildcard semantics (a null-artifact platform policy covers unknown
  artifacts by design; the gate layer remains fail-closed).
- `packages/mos-engines` (W3-B, 39 tests): registry, capability matching with deprecated
  engines surfaced (never hidden), sandbox policy descriptors (fail-closed validation);
  zero invocation code.
- `packages/mos-production` (W3-B, 81 tests): transform registry, DAG graph validation
  (cycles/orphans/unresolved refs/retired transforms/deprecated engines → named errors),
  job state machine (external zcode_execution_ref only; zero executor). TL fix:
  GraphNotFoundError import path.
- `packages/mos-distribution` (W3-C, 39 tests): intent state machine — executing/succeeded
  require approved preview binding (assertDistributionPreviewApproval), idempotency
  conflicts, evidence-ref-only execution records; zero provider I/O.
- `packages/mos-experiments` (W3-C, 35 tests): Experiment authority (decision lock 18) —
  outcome writable only through conclude() with evidence; hypothesis adoption via
  structural HypothesisUpdatePort (composition-root maps to @mos/lab saveHypothesis —
  the write right W2 reserved for W3). TL fixes: experimentInputSchema import;
  experiment_status += cancelled (additive, spec + zod); one test corrected to expect the
  schema-layer error for the non-transition conclude path.
- `packages/mos-learning` (TL, 14 tests): calibration records only from concluded
  experiments with measurement evidence (structural ExperimentLookup port);
  delayed_mode locked z.literal(true); zero route/production mutation APIs (surface
  test asserts it).

**Studio deferral (explicit):** mos-studio stays `planned` with a registry note — the
human-facing surface depends on the composition-root ownership decision that has blocked
UI mounting since Week 1; the domain seams it needs (production graph + artifact +
rights reads) are delivered by this week's modules.

**Gate wiring:** architecture-policy.yaml (+7 modules), scripts/engineering-test-files.json
(+16 files, 215 total), package.json typecheck chain (+7 packages),
module-registry-v3.0.yaml (7 contract-tested + notes; studio deferral note).

**Gate evidence (run on this tree, 2026-11-13):**

- `pnpm test:architecture`: PASS (0 fail)
- `pnpm architecture:check -- --changed`: violations 0 / baseline 0 / new 0
- `pnpm typecheck` (root, full chain incl. all 7 new packages): PASS
  (NODE_OPTIONS=--max-old-space-size=3072, unchanged local constraint)
- `pnpm lint`: 0 errors / 538 warnings — identical to the Stage 0/W1/W2 baseline
  (6 new-code warnings found and fixed before the gate run)
- `pnpm docs:stale-phrases:check` + `pnpm db:schema:check`: PASS
- `pnpm test:engineering`: 1653 passed / 1 failed / 8 skipped (215 files) — the single
  failure is the pre-existing environment-sensitive miseToolchainEnv.test.ts, identical to
  all prior baselines — not a regression. All 16 newly listed W3 test files passed
  (274 new MOS tests since W2: 1379 → 1653).
- MOS package suites: contracts 63, identity-bridge 6, integrations 48, capabilities 43,
  missions 30, routes 16, agent-organizations 56, lab 60, content-artifacts 31,
  rights-policy 35, engines 39, production 81, distribution 39, experiments 35,
  learning 14, ui mos-extension 40 — all green.

**Publication record (2026-11-13):** see the publication addendum appended after the push.

## Composition-root milestone record (branch w4/composition-root-journey, 2026-11-13)

**Stage:** the review-directed milestone before Week 4 (external review TL guidance:
"Prioritize closing the composition-root and user-journey gap before starting Week 4";
backlog spec/backlog/composition-root-milestone.md). Single TL workstream.

**Scope decisions (backlog doc, in full):** composition-root ownership resolved to
TL/mos-studio; mount form = the sanctioned ZCode plugin system (zero core edits); New Task
observation = the SessionStart hook (`source=startup`); session identity = tools/call `_meta`;
operator declaration instead of invented identity; authorized reads ride the existing ZCode
MCP client + real encrypted credential store; studio production-surface reads stay planned.

**Deliverable (all additive; zero core ZCode files touched; `git diff --name-only origin/main`
= gate wiring + docs only):**

- `packages/mos-studio` — the TL composition root as a ZCode plugin:
  - `.zcode-plugin/plugin.json`: `mos-studio` 0.1.0; `mcpServers.studio` (stdio
    `node ${ZCODE_PLUGIN_ROOT}/dist/server.mjs`); `ui.surfaces[0]` (`ui://mos-studio/panel.html`,
    availability=session, server=studio); top-level `slots` (`nav.primary` +
    `sidePane.launcher` → surface; Desktop-only, Web degrades to plain tool records).
  - `hooks/hooks.json`: SessionStart → `node ${ZCODE_PLUGIN_ROOT}/dist/hook.mjs`
    (timeoutMs 5000, onError allow; only `source=startup` counts as task creation).
  - `src/contract/*` — zod mirrors: manifest (strict keys), hooks.json, SessionStart stdin
    payload (camelCase + snake_case aliases), tools/call `_meta` session facts, operator record.
  - `src/domain/*` — availability semantics mirroring packages/ui/src/mos-extension
    (host → switch → session → mission gate order; mirror not import — deep-importing the
    host ui package violates governance; host-tree mounting of mos-extension itself remains
    deferred: it needs an upstream component edit) + pure journey projections (counts/shapes).
  - `src/application/*` — StudioService (the composition heart: per-request tenant resolution
    via IdentityBridgeService over `_meta` facts + operator declaration; mission intake
    verbatim; ConnectionStore wiring; CapabilityCatalog with the W2-verified Composio
    descriptor/implementation; RouteService evaluation; authorized-read composition), operator
    store (atomic write, corrupt fail-closed), Composio session factory client (REST, the
    documented schema/URL from @mos/integrations).
  - `src/server/*` — the MCP stdio server (8 tools; app-only `_meta.ui.visibility` for
    set-operator/connect/execute-read; business failures as structured isError results).
  - `src/hook/*` — SessionStart hook: payload → TaskCreatedEvent → MissionSidecarService
    (graceful failure; settlement poll; always exit 0) + `src/hook/main-hook.ts` entry.
  - `src/runtime/*` — real-stack wiring (production-only `@zcode/adapters` imports:
    createMcpAdapter + createSharedZCodeCredentialStore + the providerPortOverMcp bridge)
    — EXCLUDED from the default typecheck (fresh-clone-safe; `typecheck:integration` covers
    it with the documented `pnpm --filter @zcode/adapters... build` precondition, mirroring
    the @mos/adapters test/integration convention from PR #3's lesson).
  - `src/ui/*` — MCP Apps panel (model/panel.html/host/main; pure state machine in model.ts;
    operator declaration, mission intake (verbatim), connections+capabilities, routes,
    authorized read with counts-only evidence; api-key input cleared from panel state on
    submit).
  - `scripts/build.mjs` — esbuild three bundles (server.mjs bundles @zcode/* source except
    the native module chain `@napi-rs/keyring`+`koffi` which stay external for the inline
    plugin layout; hook.mjs self-contained; panel.html inlined). Install form: inline plugin
    via `plugins.dirs` (defaultEnabled) — marketplace copy-style packaging (vendoring the
    externals) is deliberately not done this milestone.
  - Tests: 7 engineering files (57 tests) + 2 package-local integration suites + 1 stand-in
    fixture (test/fixtures/standin-composio-session.mjs — the documented Composio session
    factory + session MCP shapes, contract-only).

**Gate wiring:** architecture-policy.yaml (+1 module `mos-studio`, requires the wired MOS
modules + zcode-mos-adapters + zcode-cli), module-registry-v3.0.yaml (mos-studio:
authority composition-root, stage composition-root-milestone, status contract-tested, full
note), scripts/engineering-test-files.json (+7 files, 222 total), package.json typecheck
chain (+@mos/studio), pnpm-lock.yaml (new workspace package), spec/backlog/composition-root-milestone.md,
this record.

**Gate evidence (run on this tree, 2026-11-13):**

- `pnpm typecheck` (root, full chain incl. @mos/studio): PASS
  (NODE_OPTIONS=--max-old-space-size=3072, unchanged local constraint)
- `pnpm --filter @mos/studio typecheck` + `typecheck:integration`: PASS
- `pnpm lint`: 0 errors / 538 warnings — identical to the Stage 0/W1/W2/W3 baseline
  (5 new-code warnings found and fixed before the gate run)
- `pnpm docs:stale-phrases:check` + `pnpm db:schema:check`: PASS
- `pnpm test:architecture`: PASS (61/61, 0 fail)
- `pnpm architecture:check -- --changed`: violations 0 / baseline 0 / new 0
- `pnpm test:engineering`: 1710 passed / 1 failed / 8 skipped (222 files) — the single
  failure is the pre-existing environment-sensitive miseToolchainEnv.test.ts (sandbox node
  at /usr/bin), identical to all prior baselines — not a regression. All 7 newly listed
  mos-studio test files passed (57 new tests since W3: 1653 → 1710)
- `pnpm --filter @mos/studio test` (structural + real-stack integration): 62 passed /
  3 skipped (live suite) — all green
- `pnpm --filter @mos/studio build`: PASS (server.mjs, hook.mjs, ui/panel.html)

**Real-stack journey evidence (test/integration, package-local, dist precondition):**

1. Real plugin discovery (`discoverNodePlugins` over `plugins.dirs`): mos-studio parses,
   enabled by default, 1 ui surface (`ui://mos-studio/panel.html`, runtime server
   `plugin:mos-studio:studio`), SessionStart hook registered, zero plugin diagnostics.
2. Built server.mjs over the REAL `createMcpAdapter` stdio transport with `_meta` injected
   via the real per-request mechanism (trace.sessionId + workspaceKey): status → operator
   declaration → real hook.mjs subprocess (real-shaped SessionStart payload on stdin) →
   mission created + linked to the session → panel-style connect (key saved only to the
   REAL shared credential store, isolated via ZCODE_DATA_BASE_DIR; connection record holds
   only the opaque ref) → capability resolves `available` → routes evaluate `existing` →
   authorized read over a local stand-in session factory + session MCP (http transport,
   x-api-key injected): succeeded with counts-only evidence; stand-in record values
   machine-checked absent from the result. Negative: read without connection → typed
   error; resume-source hook → no mission; no `_meta` → honest session_context_unavailable.
3. LIVE Composio journey (env COMPOSIO_API_KEY, real provider, 3/3 PASS): the same journey
   against the REAL Composio REST session factory + REAL hosted session MCP:
   `mos_execute_authorized_read` → COMPOSIO_MULTI_EXECUTE_TOOL → HACKERNEWS_SEARCH_POSTS →
   succeeded; evidence carries the documented-shape counts (results_count/total_count ≥ 1),
   never the key (machine-checked). Invalid key → 401 → failed (unauthorized), key absent
   from all outputs. Credential store round-trip encrypted at rest (machine-checked).

**Honest limits (unchanged blockers):** Desktop visual mount (the panel inside the real
Desktop MCP Apps sandbox) and desktop E2E remain blocked — no docker/display on this sandbox
(renderer-scale builds OOM; same blocker as Weeks 1–3). Web-side journey = the upstream
plain-tool-record fallback (automatic; no MOS-side work) — cited from source, not visually
verified. Cross-client visual regression therefore remains open with those blockers.
HubSpot remains blocked at the account boundary (Google SSO 2-Step Verification requires
the account owner's device; HubSpot-native password for payswaporg@gmail.com is not the
Google password; nothing was reset or worked around) — its descriptor stays
toolMappingVerified=false and the evidence record is unchanged.

**Publication addendum (2026-11-13, composition-root milestone):**

- `git push -u origin w4/composition-root-journey` succeeded (GitHub identity
  `payswaporg`, PAT in-environment only; credentials never in the repo). Pre-push gate
  `verify:pre-push` fully green during the push: worktree check, e2e remote targets, lint
  (0 errors / 538 baseline warnings), docs:stale-phrases:check, db:schema:check,
  test:architecture (61/61), architecture:check --changed (violations 0 / baseline 0 / new 0).
  `test:engineering:affected --scope push` used the caller-specified baseline
  `ZCODE_PRE_PUSH_BASE=origin/main` (same supported override as W1–W3); Vitest selected the
  entire 222-spec engineering suite and the script skipped per its full-selection rule
  (never blocks the push); the full-suite result is recorded above (1710 passed / 1
  pre-existing environment failure / 8 skipped). No repository file was modified for the
  override.
- **PR #6 opened and MERGED to main**: merge commit
  `8834b35ecb5761f309e4da86a51eb09eb251727c` (merge method: merge commit, consistent with
  PRs #1–#5) — https://github.com/payswapdotorg/MOS-3.0/pull/6 (head
  `w4/composition-root-journey` → base `main`; 1 commit, 51 changed files; body from
  `docs/handoff/w4-pr-body.md`). Local main synced to `8834b35e`, worktree clean. The
  composition-root milestone code is now the canonical main.
- Remaining open items after this milestone: Desktop visual mount + desktop E2E (no
  docker/display; same hardware blocker as Weeks 1–3), cross-client visual regression
  (same blocker), HubSpot live read (blocked at the account owner's Google 2-Step
  Verification — all methods require their physical device; nothing reset or bypassed),
  mos-studio production-surface reads (domain seams delivered in W3; wiring planned for a
  later studio milestone), marketplace copy-style plugin packaging (vendoring the external
  native module chain).

## Week 4 record (branch w4/economy-capacity, 2026-11-14)

**Stage:** Week 4 model/engine economy and network capacity (architecture §12; economic
model §8; backlog spec/backlog/week-4-economy-capacity.md). Single TL workstream (the
composition-root precedent; both modules share the contract extension and would collide
on shared-contract ownership under worker split).

**Scope decisions (backlog doc, in full):** service offers are NOT re-modeled (W2
NodeOffer + fail-closed publish gate stays authoritative; mos-resource-network consumes
offers only via the injected `OfferLookup` port, mos-lab precedent); code-level
dependencies stay `@mos/contracts`-only (registry-level mos-agent-organizations /
mos-capabilities / mos-integrations dependencies reconcile through structural lookup
ports wired by the composition root); Gig = the §8 Human Production Task Package
verbatim; do-not-assign-people-by-default is contract invariant §23, not advice;
pricing history is append-only (§24); customer/market intelligence is evidence-gated
(§25) with opaque subject refs (zero PII in records); discovery surfaces, never hides
(§26).

**Deliverables (all additive; zero core ZCode files touched; `git diff --name-only
origin/main` = gate wiring + docs only):**

- `packages/mos-contracts` (TL): additive objects NetworkNode, Gig, ExecutionOption,
  RouteComparison, CommerceProduct, PriceRecord, MarketIntelligenceRecord in a new
  `src/contract/economy.ts` (zod projection of the new YAML `# ===== Week 4 additive
  objects =====` block, field-for-field); 8 new enums (Week 4 block in enums.ts); 4 new
  invariant guards §23–§26 appended to invariants.ts (gig human-assignment justification
  covering agent/engine + no-op/reuse comparison with adequacy unknown never counting as
  adequate; price-record immutability; market-intelligence evidence gate; discovery
  honest surfacing). 82 tests (+19; the W3-era file count 63 → 82).
- `packages/mos-resource-network` (60 tests, 5 files): NetworkNode registration store
  (`mos-network-nodes.json`, upsert by id, active/inactive); Gig state machine
  (draft → published → assigned → in_progress → delivered → accepted/rejected;
  cancelled from pre-delivery states; unknown: no out-edges) with two fail-closed gates —
  publish requires the full §8 package (deadline / budget_reward /
  expected_value_of_waiting / alternative_route_ids), human assignment additionally
  requires the §23 route comparison (candidate-class coverage, zero adequate non-human
  options, evidence refs; typed GigAssignmentBlockedError with the named missing list);
  pure `compareExecutionOptions` (recommendation order no-op/reuse > agent/engine >
  human per decision locks #17/#8-paragraph; empty input → no_adequate_route, never
  default-to-human); pure `discoverCapacityForCapability` (matched/excluded with named
  reasons across network nodes + NodeOffers + engines — the mos-engines
  deprecated-surfaced idiom; OfferLookup/EngineLookup ports injected by the composition
  root); GigStore (`mos-gigs.json`) with §23 guard re-run at every persist boundary.
- `packages/mos-commerce` (39 tests, 3 files): CommerceProduct registration store
  (draft → active → retired state machine); PriceRecord append-only history
  (`mos-commerce-prices.json`) — zero update API for amount/model/effective window
  (§24: supersession = append new record + retire old with `superseded_by` pointer;
  §24 guard at every persist), same-product+model active-window overlap → typed
  PriceConflictError; MarketIntelligenceRecord store with §25 double gate
  (intake schema `evidence_refs` min(1) + guard at persist) and opaque `subject_ref`
  (zero PII), facts carried verbatim (zero inference).

**Gate wiring:** architecture-policy.yaml (+2 modules), module-registry-v3.0.yaml (both
flipped to contract-tested with dated notes), scripts/engineering-test-files.json
(+10 files, 232 total — including the W3 gate wiring's omitted
`packages/mos-contracts/test/week3-contract-schemas.test.ts`, backfilled here and
flagged in the PR body), package.json typecheck chain (+@mos/commerce
+@mos/resource-network), pnpm-lock.yaml (2 new workspace importers).

**Gate evidence (run on this tree, 2026-11-14):**

- `pnpm typecheck` (root, full chain incl. both new packages): every step PASS —
  session-control, all 18 MOS package typechecks (incl. @mos/commerce and
  @mos/resource-network), main-tree `tsc -b` (19 tsconfigs), remote-main + zcode-cua.
  Environment note (recorded for lineage honesty): this 4 GiB sandbox OOM-killed the
  chain at the previously recorded `--max-old-space-size=3072` heap; the identical
  chain passes end-to-end at `--max-old-space-size=2560` per process. Same
  environment-only class as the recorded renderer-scale OOM (adequate-hardware record);
  no repository file was modified for the heap adjustment.
- `pnpm --filter @mos/contracts test`: 82 passed (6 files).
- `pnpm --filter @mos/commerce test`: 39 passed (3 files).
- `pnpm --filter @mos/resource-network test`: 60 passed (5 files).
- `pnpm lint`: 0 errors / 538 warnings — identical to the Stage 0/W1–W4-milestone
  baseline (3 new-code unused-import warnings found and fixed before the gate run).
- `pnpm docs:stale-phrases:check`: PASS (2292 files). `pnpm db:schema:check`: PASS.
- `pnpm test:architecture`: PASS (61/61, 0 fail).
- `pnpm architecture:check -- --changed`: violations 0 / baseline 0 / new 0.
- `pnpm test:engineering`: **first run failed 2 files** — the pre-existing
  environment-sensitive miseToolchainEnv.test.ts (identical to all prior baselines)
  PLUS packages/server/test/remoteOfficialPluginAssets.test.ts (fresh-clone build-state
  gap: `@zcode/contracts` exports resolve to `dist/`, which no gate step builds; the
  failure is not caused by this branch's code). Corrected run after
  `pnpm --filter @zcode/contracts build` (recorded here per update rules, nothing
  deleted): **1845 passed / 1 failed / 8 skipped (232 files)** — the single failure is
  the pre-existing miseToolchainEnv.test.ts, not a regression. 135 new tests since the
  composition-root milestone (1710 → 1845: +19 contracts, +17 W3-contracts backfill,
  +39 commerce, +60 resource-network).

**Honest limits (unchanged blockers + new notes):** Desktop visual mount + desktop E2E,
cross-client visual regression (no docker/display — same hardware blocker as Weeks
1–4-milestone); HubSpot live read (account owner's Google 2-Step Verification — nothing
reset or bypassed); mos-studio production-surface reads (later studio milestone);
marketplace copy-style plugin packaging. New notes: OfferLookup/EngineLookup composition
root wiring (studio/service layer) belongs to a later milestone — this stage delivers
the ports and the pure discovery functions over injected records; `@zcode/contracts`
dist is not produced by any root gate step (pre-existing build-state gap surfaced by
the fresh clone; flagged for a future gate-wiring decision, not fixed here to keep this
branch additive-only).

**Publication addendum:** see the publication note appended after the push.
