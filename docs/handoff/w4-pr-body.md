# Composition-root milestone: New Task → Mission journey closure (mos-studio plugin)

Review-directed milestone before Week 4 (external review TL guidance: "Prioritize closing the
composition-root and user-journey gap before starting Week 4"). Backlog:
`spec/backlog/composition-root-milestone.md`.

## What this delivers

**`packages/mos-studio` — the TL-owned central composition root as a ZCode plugin**
(zero core ZCode files touched; `git diff --name-only origin/main` = gate wiring + docs only):

- **Mount**: `.zcode-plugin/plugin.json` with `ui.surfaces` (MCP Apps panel
  `ui://mos-studio/panel.html`) + top-level `slots` (`nav.primary`, `sidePane.launcher` →
  surface). Desktop renders the panel in the sanctioned MCP Apps sandbox; Web/remote keep
  plain MCP tool records (upstream fallback, no MOS-side work). Install form: inline plugin
  via `plugins.dirs` (defaultEnabled).
- **New Task observation**: `hooks/hooks.json` SessionStart → built `hook.mjs`; only
  `source=startup` (a new task's first turn) maps to the `TaskCreatedEvent` fact →
  @mos/missions MissionSidecarService (graceful failure; `onError: allow`; always exit 0 —
  the standard task path is never touched; New Task control preserved by construction).
- **Session linkage**: tools/call `_meta` (injected by the real ZCode MCP client for model and
  panel calls) carries session/workspace facts; missions store only
  `source_zcode_session_id` references (ZCode remains the sole authority).
- **Operator declaration** (not invented identity): the plugin surface has no ZCode account
  user-id fact, so the operator declares once via the panel; undeclared → tenant resolution
  fails closed with the recorded reason.
- **Capabilities & routes**: panel tools resolve capability instances for connected accounts
  (fail-closed: `available` requires connected + scopes + verified tool mapping +
  implementation evidence) and evaluate route candidates (existing/conditional/blocked/unknown).
- **One authorized read**: `mos_execute_authorized_read` composes the REAL ZCode MCP client
  (`createMcpAdapter`, http transport, x-api-key runtime-injected) + the REAL shared
  encrypted credential store (opaque `credential_ref` only) → Composio REST session factory →
  hosted session MCP → `COMPOSIO_MULTI_EXECUTE_TOOL` → `HACKERNEWS_SEARCH_POSTS`; evidence is
  counts/shapes only (documented Composio shape projected to counts; generic `recordCount`
  stays honestly `null`/unknown for that shape).
- **Typecheck discipline**: production real-stack wiring (`src/runtime`, `@zcode/adapters`
  imports) is excluded from the default typecheck; `typecheck:integration` covers it with the
  documented `pnpm --filter @zcode/adapters... build` precondition (the @mos/adapters
  convention; fresh-clone-safe per PR #3's lesson).

## Gate evidence (this tree, 2026-11-13)

- `pnpm typecheck` (root): PASS (NODE_OPTIONS=--max-old-space-size=3072, unchanged local constraint)
- `pnpm lint`: 0 errors / 538 warnings — identical to the Stage 0–W3 baseline (5 new-code warnings fixed pre-gate)
- `pnpm docs:stale-phrases:check` + `pnpm db:schema:check`: PASS
- `pnpm test:architecture`: PASS (61/61)
- `pnpm architecture:check -- --changed`: violations 0 / baseline 0 / new 0
- `pnpm test:engineering`: **1710 passed / 1 failed / 8 skipped** (222 files) — the single
  failure is the pre-existing environment-sensitive `miseToolchainEnv.test.ts` (sandbox node
  at /usr/bin), identical to all prior baselines. All 7 new mos-studio test files green
  (57 new tests: 1653 → 1710).
- `pnpm --filter @mos/studio test`: 62 passed / 3 skipped (live suite) — structural + real-stack integration
- `pnpm --filter @mos/studio build`: PASS

## Real-stack + live journey evidence (package-local, dist precondition)

1. **Real plugin discovery** (`discoverNodePlugins` over `plugins.dirs`): manifest + ui
   surface + SessionStart hook parse with zero plugin diagnostics.
2. **Full journey over the real stack**: built `server.mjs` over the real `createMcpAdapter`
   stdio transport with real `_meta` injection → operator → real `hook.mjs` subprocess with a
   real-shaped SessionStart payload → mission created + linked → connect (key only into the
   real encrypted credential store) → capability `available` → route `existing` → authorized
   read over a local stand-in session factory/MCP (http + x-api-key): counts-only evidence,
   stand-in record values machine-checked absent.
3. **LIVE Composio journey** (`COMPOSIO_API_KEY` present, 3/3 PASS): the same journey against
   the REAL Composio factory + hosted session MCP → real HACKERNEWS read succeeded with
   documented-shape counts; invalid key → 401 → unauthorized classification; credential
   store encrypted at rest (machine-checked).

## Honest limits (visible blockers, unchanged)

- Desktop visual mount + desktop E2E: blocked (no docker/display on this sandbox;
  renderer-scale builds OOM locally — same blocker as Weeks 1–3). Web-side journey is the
  upstream plain-tool-record fallback (automatic, cited from source).
- HubSpot: still blocked at the account boundary — Google SSO requires the account owner's
  2-Step Verification (all methods need their physical device); the HubSpot-native password
  for this email is not the Google password; nothing was reset or bypassed. Descriptor stays
  `toolMappingVerified=false`; evidence record unchanged.
- mos-studio production-surface reads (production graph/artifact/rights): domain seams
  delivered in W3; panel wiring remains planned for a later studio milestone.
- Marketplace copy-style plugin packaging (vendoring the external native module chain):
  deliberately not done; install form is the inline plugin (`plugins.dirs`).

## Changed files

New: `packages/mos-studio/**`, `spec/backlog/composition-root-milestone.md`,
`docs/handoff/w4-pr-body.md`.
Modified (gate wiring + records): `architecture-policy.yaml`,
`spec/architecture/module-registry-v3.0.yaml`, `scripts/engineering-test-files.json`,
`package.json`, `pnpm-lock.yaml`, `docs/handoff/IMPLEMENTATION-STATE.md`.
