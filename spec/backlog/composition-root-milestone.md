# Composition-root milestone — New Task → Mission journey closure (backlog)

Stage: the review-directed milestone **before** Week 4 (architecture §12 Week 4 = model/engine
economy and network capacity). External review TL guidance: "Prioritize closing the
composition-root and user-journey gap before starting Week 4."

Module in scope (spec/architecture/module-registry-v3.0.yaml, stage composition-root-milestone):

- `mos-studio` — the TL-owned central composition root, delivered as a ZCode plugin
  (`.zcode-plugin/plugin.json` with `ui.surfaces` + top-level `slots` + `hooks` SessionStart),
  zero core ZCode files touched.

## Scope decisions (explicit)

- **Composition-root ownership resolved**: the central composition root is TL-owned and lives
  in the `mos-studio` package (registry authority `composition-root`). This closes the
  ownership blocker that had deferred in-app UI mounting since Week 1.
- **Mount form = the sanctioned ZCode plugin system, not host-tree edits**: mounting into the
  host UI tree would require editing upstream React components (forbidden); the plugin surface
  (`ui.surfaces` + `slots` nav.primary/sidePane.launcher → surface) is the documented additive
  path. Desktop renders the panel (MCP Apps sandbox); Web/remote keep plain MCP tool records
  (upstream fallback, no MOS-side work).
- **New Task observation = the SessionStart hook** (`source=startup` fires on every new task's
  first turn in both CLI and Desktop runtimes; payload carries sessionId + cwd). Tasks ARE
  sessions in ZCode (no separate taskId). The hook maps the payload to the
  `TaskCreatedEvent` fact and runs the @mos/missions sidecar (graceful failure, never touches
  the standard task path; `onError: allow` + always exit 0).
- **Session identity inside the plugin = tools/call `_meta`** (injected by the real ZCode MCP
  client for both model- and panel-initiated calls; session_id + workspace facts). Missing
  `_meta` = missing facts (fail-closed, honest degradation).
- **Operator declaration, not invented identity**: the plugin surface has no ZCode account
  user-id fact. The operator declares themselves once via the panel (`mos_set_operator`,
  `loginProvider: mos_operator_declaration`); undeclared → tenant resolution fails closed with
  the recorded reason.
- **Authorized reads ride the existing runtime**: `mos_execute_authorized_read` composes the
  real ZCode MCP client (`createMcpAdapter` http transport, x-api-key runtime-injected) and the
  real shared encrypted credential store (`createSharedZCodeCredentialStore`; opaque
  `credential_ref` only). Provider evidence discipline unchanged (counts/shapes only).
- **mos-studio production-surface reads (production graph/artifact/rights) remain planned**:
  W3 delivered the domain seams; their panel wiring is a later studio milestone.

## Journey (the review's seven steps)

1. New Task control preserved (zero core edits; upstream task path untouched).
2. MOS mission sidecar/context UI mounted (plugin surface panel + nav/sidePane slots).
3. Mission connected to the original ZCode session (`source_zcode_session_id` references;
   ZCode remains the sole authority of session/task state).
4. Capabilities of connected accounts resolved (fail-closed: available requires connected +
   scopes + verified tool mapping + implementation evidence).
5. Available/conditional routing shown (route candidates over resolved instances).
6. One real authorized read executed through the existing ZCode MCP client + encrypted
   credential store (Composio session MCP → HACKERNEWS_SEARCH_POSTS).
7. Journey verified: engineering suite (structural) + package-local real-stack integration
   (built bundle over the real client/credential store/real plugin discovery) + live Composio
   journey with a real key. Desktop visual mount and desktop E2E remain blocked on hardware
   (no docker/display in this environment — same blocker as Weeks 1–3); Web-side behavior is
   the upstream plain-tool-record fallback.

## Exit criteria

- All gates green at the pre-push gate (lint / docs / db / test:architecture /
  architecture:check --changed / test:engineering:affected --scope push).
- Engineering suite: new mos-studio test files all green; no regressions (the single
  pre-existing environment-sensitive failure stays visible and unchanged).
- Package-local: `typecheck`, `typecheck:integration` (documented dist precondition), `test`
  (structural + real-stack integration), live journey green with `COMPOSIO_API_KEY` present.
- Zero core ZCode files touched (`git diff --name-only origin/main` limited to gate wiring +
  the new package + docs).
