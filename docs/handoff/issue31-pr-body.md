# Issue #31 — first usable Marketing Lab → Studio workflow (streams A + B)

**Branch:** `tl/issue-31-first-product-workflow` → `main`
**Work package:** `spec/backlog/post-week-4-first-product-workflow.md` (new, this PR)
**First TL report (pre-code):** `payswapdotorg/MOS-3.0#issuecomment-6915209686`
**Baseline:** `main` @ `a81c9414` (verified; CI green; rc.1–rc.3 published)

## What this delivers

The first user-visible product workflow through the existing MOS/ZCode application:

**New Task → Mission (existing sidecar) → Marketing Lab (authorized-read evidence → research notes with facts-vs-insight separation → hypotheses) → capabilities/routes (existing, fail-closed) → Studio draft production brief (artifact version chain + provenance + honest rights status) → review (append-only rights record + next artifact version).**

- **Stream A (docs truth):** canonical work package added; README status + release-engineering backlog corrected against the verified published RCs (they said "no release published yet").
- **Stream B (product slice):** all inside `packages/mos-studio` (TL composition root) —
  - `evidence-store.ts` + `evidence.ts` (contract): successful authorized reads land as tenant-scoped, source-attributed, counts-only evidence records (kind `provider_response`, mission-linked, atomic write, fail-closed read boundary).
  - Research notes via the real `@mos/lab` write boundary (`ResearchNoteStore` + tenant-closed `EvidenceLookup`): findings must cite existing non-simulation evidence; insight is a separate field; hypotheses never carry experiment outcomes (decision lock #18).
  - Draft briefs via the real `@mos/content-artifacts` (first-version `draft` artifact: opaque content_ref, provenance = mission + evidence sources, rights honestly `unknown`, quality `unreviewed`) and review via the real `@mos/rights-policy` (append-only `review_decision` + next artifact version; lineage verbatim).
  - Composition split: `lab-draft-composition.ts` + `studio-shared.ts` keep both files under the 800-line cap — **no lint/architecture exceptions introduced**; `StudioService` keeps the single public API.
  - 8 new MCP tools (review app-only: human decision); panel gains Marketing Lab + Studio drafts sections (evidence "Use" affordance, facts/insight separation visible, brief cards with quality/rights pills + Approve/Reject).
  - Registry/policy wiring: `requires` gains `mos-lab`, `mos-content-artifacts`, `mos-rights-policy` (mirrored in `module.ts`; machine-checked).

## Gate evidence (this tree, 2026-11-16)

| Gate | Result |
|---|---|
| `pnpm typecheck` (root chain, `NODE_OPTIONS=--max-old-space-size=3072`) | PASS |
| `pnpm --filter @mos/studio typecheck` | PASS |
| `pnpm --filter @mos/studio test` | **86/86** (10 files) |
| — incl. new `test/lab-draft-journey.test.ts` | evidence persistence/restart, facts-cite-real-evidence, no-outcome hypotheses, dangling-ref typed errors, artifact v1→v2 review chain, cross-tenant invisibility |
| — incl. real-stack integration (plugin discovery, real MCP stdio, real credential store, real SessionStart hook) | green |
| — incl. **live Composio journey** (real provider) | **PASS** — full journey + real authorized read (HACKERNEWS_SEARCH_POSTS) succeeded in the fresh environment; wrong-key 401 → unauthorized. The plugin's session-factory + hosted-session-MCP path is unaffected by Composio's v1 REST deprecation. |
| `pnpm lint` | **0 errors** / 548 warnings (538 baseline + 10 pre-existing from main's PR #29 release-smoke files; 0 from this change) |
| `pnpm test:architecture` / `pnpm architecture:check -- --changed` | PASS / violations 0 · baseline 0 · new 0 |
| `pnpm docs:stale-phrases:check` / `pnpm db:schema:check` | PASS / PASS |
| `pnpm --filter @mos/studio build` (documented adapters-build precondition) | PASS (server.mjs, hook.mjs, ui/panel.html) |
| `pnpm test:engineering` | **1896 passed / 1 failed / 8 skipped** (236 files; the 1 failure is the pre-existing environment-sensitive `miseToolchainEnv.test.ts`, identical to every prior baseline) |
| Scope review (`git diff main --name-only`) | only `packages/mos-studio/**` + gate wiring + spec/docs; zero core ZCode files; Muse PRs #27/#30 untouched; no Issue #23 billing paths |

## Preservation

Ordinary New Task is unchanged (hook semantics, negative tests green); with MOS disabled nothing mounts and no mission is created (existing negatives). No ZCode profile data is touched. No external writes exist anywhere in the new surface — review is a rights record, not a publishing action.

## Honest limits (AGENTS.md §7 vocabulary)

- Milestone status: **contract-tested** (real-stack + live provider evidence recorded; installed-app journey evidence pending the release pipeline clean-machine smokes — a new RC publishes only when those gates pass, after this PR merges).
- Desktop visual mount / desktop E2E remain blocked on this sandbox (no docker/display) — unchanged since Week 1.
- `mos-production` graph wiring remains planned (registry note updated): the draft brief is human-composed from evidence, not engine-produced.
- Panel note form captures one finding per submit in v1 (MCP tool accepts up to 20).

## Rollback

All changes are additive inside `packages/mos-studio` + registry/policy entries; reverting the merge commit restores the previous composition root with no data migration (the two new JSON stores are created lazily on first use and are inert if the code is absent).

Closes nothing automatically: Issue #31 stays open until the installed-app RC evidence lands (Stream C).
