# Post-Week-4 product milestone — first usable Marketing Lab → Studio workflow (backlog)

**Status:** in progress (TL stream execution started 2026-11-16)
**Owner:** Tech Lead (TL) — single-operator environment; streams below carry explicit allowed/forbidden paths per `AGENTS.md` §5
**Issue:** payswapdotorg/MOS-3.0#31 (product-owner handoff; first TL report posted there 2026-11-16)
**Baseline:** `main` at `a81c9414046749e9e74ac5e13832fd4d7990b9b1` (2026-11-15; PR #29 merged; `MOS CI` green; releases `mos-v3.0.0-rc.1`…`rc.3` published)

## Objective

Deliver the first **useful, user-visible MOS product workflow** through the existing MOS/ZCode
application:

**New Task → Mission → Marketing Lab research/evidence → strategy and route comparison →
Studio draft production brief/artifact → review.**

A narrow first product slice. Not every planned connector, engine or publishing platform. The
ordinary ZCode New Task journey stays unchanged and must keep working with MOS disconnected
or disabled.

## Modules in scope

- `mos-studio` — the TL-owned composition root and the only composition surface (existing
  ZCode plugin: `ui.surfaces` + `slots` + SessionStart hook). All journey wiring lives here.
- Consumed through their existing contracts (no registry change, no new module):
  `mos-missions` (mission link), `mos-lab` (research notes / evidence lookup / hypothesis
  proposals), `mos-capabilities` + `mos-routes` (account-specific availability, fail-closed),
  `mos-production` (production graph), `mos-content-artifacts` (draft artifact + lineage),
  `mos-rights-policy` (rights/consent record on the artifact).
- Identity/tenant resolution through the existing `mos-identity-bridge` + operator declaration
  (unchanged from the composition-root milestone).

## Scope decisions (explicit)

1. **Product surface = the existing `mos-studio` plugin panel** (`ui://mos-studio/panel.html`,
   Desktop MCP Apps surface + nav/side-pane slots). No replacement shell, no Next.js app, no
   dashboard root, no second UI framework, no host-tree (upstream React) edits.
2. **New Task observation stays the SessionStart hook** (`source=startup` only) with graceful
   failure and always-exit-0 semantics (unchanged). The mission sidecar link stays
   tenant-scoped and durable.
3. **Evidence honesty**: research notes carry source attribution (provider + operation + record
   counts/provenance shape); `mos-lab` separates facts (source-backed research notes) from
   hypotheses (hypothesis proposals). No demo data; unknown stays unknown; unavailable
   providers surface as blocked, never as fake evidence.
4. **Route comparison truth**: capability/route evaluation keeps the fail-closed
   existing/conditional/blocked/unknown semantics from `mos-capabilities`/`mos-routes`.
5. **Draft artifact**: the Studio draft brief is a `mos-content-artifacts` artifact version with
   source lineage (which evidence and routes fed it) and a `mos-rights-policy` rights/consent
   record. It is reviewable in the panel. **No external writes**: no publishing, no external
   side effects, no new tool executors — anything beyond reading stays out of scope.
6. **Real evidence only**: reuse the authorized read path (existing ZCode MCP client + real
   encrypted credential store; the recorded provider is Composio). The provider path must be
   re-verified in this environment (Composio v1 REST deprecation observed 2026-11-16); if it
   fails, evidence capture ships honestly degraded with a visible blocked status.
7. **Persistence**: tenant-scoped state through the existing approved persistence mechanisms
   the domain packages already use. State survives app restart. No ZCode profile data
   (`~/.zcode`) is ever written by MOS.
8. **Locked decisions unchanged**: no ACR is opened by this milestone (no locked decision
   changes; composition stays within the sanctioned plugin system and existing module
   boundaries). An ACR is required only if implementation proves a locked decision must
   change — then work stops and the ACR is written first.

## The vertical journey (acceptance shape)

1. User creates a task with the ordinary New Task controls (unchanged); MOS links a mission
   sidecar (existing hook path) to the ZCode session.
2. User opens **Marketing Lab** from the MOS entry (nav/side-pane → panel): inspects the
   mission, captures source-backed evidence (authorized read with provenance), records
   hypotheses and ideas/strategies — facts and hypotheses are visually and structurally
   distinguishable.
3. Capabilities and route candidates show account-specific existing/conditional/blocked/unknown
   states; strategy comparison summarizes the route evaluation.
4. **Studio draft**: the user composes a draft production brief from the mission, selected
   evidence and route comparison; it is stored as an artifact version with lineage and a
   rights/consent record; the user can review it in the panel.
5. Restart: mission, evidence, hypotheses, strategies and the draft artifact persist
   (tenant-scoped). Ordinary New Task behavior is unchanged throughout; with MOS disabled
   nothing mounts and no mission is created (existing negatives).

## Work streams (one owner each; ≤ 3 parallel per AGENTS.md §5)

### Stream A — canonical truth (TL; docs only)

- **Allowed paths:** `README.md`, `spec/backlog/release-engineering.md` (status lines),
  `spec/backlog/post-week-4-first-product-workflow.md` (this file).
- **Output:** stale "no release / next release" claims corrected against the verified
  published RCs; this work package as the canonical scope for the milestone.
- **Acceptance:** every status claim matches verified GitHub Releases and the module registry
  (`contract-tested` vocabulary per AGENTS.md §7); `docs:stale-phrases:check` clean.
- **Status:** delivered 2026-11-16 (this commit).

### Stream B — product surface + vertical journey (TL)

- **Allowed paths:** `packages/mos-studio/**` (panel model/panel/host, StudioService, MCP tool
  surface, tests); consumption-side extensions only where a contract genuinely lacks a needed
  field: `packages/mos-lab/src/contract/**`, `packages/mos-lab/src/application/**`,
  `packages/mos-production/**`, `packages/mos-content-artifacts/**`,
  `packages/mos-rights-policy/**` (+ their tests); gate wiring
  (`scripts/engineering-test-files.json`, root `package.json` typecheck chain if new test
  files are registered, `pnpm-lock.yaml` only if dependencies change — none expected).
- **Forbidden paths:** any `packages/zcode-*` or `packages/desktop`/`packages/ui`/`packages/services`
  core file, upstream `apps/**`, `architecture-policy.yaml` (no new module), the Muse branches
  (#27/#30), anything Issue #23 billing-related.
- **Output:** the journey in §"The vertical journey" end-to-end in the plugin panel + MCP tools,
  with per-package contract tests and the package-local real-stack integration journey extended
  from mission-link through draft-brief review.
- **Acceptance:** all new tests + existing suites green; `git diff --name-only origin/main`
  shows only allowed paths; panel state machine stays pure and testable (`model.ts` pattern).

### Stream C — real evidence + installed-app verification (TL)

- **Allowed paths:** evidence records under `spec/integrations/provider-evidence/**`,
  release/verification runs (no source edits outside Stream B paths; release pipeline
  invocation only).
- **Output:** (1) re-verified live Composio authorized read in this environment (sanitized
  provenance) or an honest blocked record; (2) release-pipeline verification of the packaged
  plugin (clean-machine smokes, 4 platforms) and a new RC **only if** all release gates pass.
- **Acceptance:** live-read evidence or visible blocked status (never demo data); release
  evidence bundle (manifest/checksums/smoke) recorded; publication record appended to
  `docs/handoff/IMPLEMENTATION-STATE.md`.

## Out of scope (explicit)

- External publishing/writes of any kind; platform connectors beyond the one verified
  authorized-read provider; engine execution (W3 engines stay contract-tested); Muse Code
  (Issue #24 / PRs #27/#30 — untouched); Issue #23 provider backend (external, blocked);
  the parked per-installation Start Plan branch (blocked on a canonical-policy decision,
  surfaced in the Issue #31 first TL report).

## Honest blockers (carried from the first TL report)

1. No docker/display on the TL sandbox → desktop visual mount + desktop E2E verified through
   the release pipeline's clean-machine smokes and package-local real-stack integration;
   visual recordings only where the environment allows.
2. Composio public REST v1 deprecation (observed 2026-11-16, HTTP 410) → the session-factory +
   hosted session MCP path must be re-validated in Stream C before evidence capture can be
   marked integrated; failure degrades the feature honestly to blocked.
3. Issue #23 billing backend is external and unchanged.
4. An attended Windows acceptance run remains product-owner-side.

## Records

- First TL report: `payswapdotorg/MOS-3.0#issuecomment-6915209686` (2026-11-16).
- Delivery record (gate evidence, journey evidence, honest limits, publication) is appended to
  `docs/handoff/IMPLEMENTATION-STATE.md` at milestone completion, per its update rules.
