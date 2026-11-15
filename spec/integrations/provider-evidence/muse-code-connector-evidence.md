# Muse Code delegated backend evidence record

Issue #24 / ACR-0002. Evidence vocabulary follows AGENTS.md §7 strictly.

## Status (AGENTS.md §7 vocabulary only)

- Backend integration (delegated turn executor + dual official execution surfaces + Host
  service + settings UI): **contract-tested** (rev. 2: mock-CLI contract suites + the
  installed official `@muse-code/sdk@1.4.20` package's exported/type surface verified
  against the adapter's usage, on-machine in this repository; rev. 3: verification-round
  corrections — documented `--workspace` flag on the exec surface, exact lockstep version
  gate, workspace-root enforcement on session resume — all with regression tests; rev. 4:
  safety corrections — canonical physical workspace root persisted in the session mapping
  with per-resume physical re-resolution (symlink retarget refused on both surfaces),
  unresolvable workspace boundaries rejected before spawn (no lexical fallback; ENOENT/
  EACCES contract-tested), and the MSP startup timeout closing late-resolving clients with
  the session-open phase gated — all with regression tests; rev. 5 (MC-D): selection-driven
  delegated routing for the existing Composer Muse Spark Contributor selection — shared
  family rule + CLI-side admission routing + renderer model-aware stamping, selector
  unlocked, Studio covered by construction, and exact per-run model selection through the
  official MSP `model/list` + `session/start`/`setModel` chain or the documented exec
  `--model` flag (TL correction round; see §1 MC-D entries) — a real signed-in `muse` CLI
  binary is still not present in this environment).
- Real provider execution (real Muse Code CLI task on the user's Windows machine): **planned**
  — checklist in §4 must be executed on the target machine and its evidence appended here
  before any status may be raised to `integrated` or `verified`.
- OpenRouter / Meta Model API routes: unchanged; the free `muse-spark-1.2-contributor-free`
  Zen model entry in the builtin provider catalog is not modified by this work.
- PR #27 external review rev. 2 status: all seven ordered revision requirements (R1–R7)
  addressed; see ACR-0002 §Revision 2. **Rev. 3 (external verification round 2, 2026-11-15):**
  three code corrections delivered (documented `--workspace` flag, exact lockstep gate,
  resume workspace-root enforcement — see ACR-0002 §Revision 3) plus the scoped follow-up
  work package MC-D for explicit model/Contributor selection. **Rev. 4 (external verification
  round 3 / TL correction round on PR #27, 2026-11-15):** three safety corrections delivered
  (A: canonical-root resume gate with symlink-retarget regression on both surfaces; B:
  unresolvable-boundary spawn rejection with ENOENT/EACCES tests; C: late-resolving MSP
  clients closed under a gated startup — see ACR-0002 §Revision 4). **Rev. 5 (MC-D,
  2026-11-15; ACR-0002 §Revision 5):** verification on the installed RC3 (built from
  `3832d055`, before PR #27) confirmed the Composer already carries the Muse Spark
  Contributor selection (`meta/muse-spark-1.3-contributor`) and its HTTP endpoint is blocked
  by the account's training-policy; MC-D delivers selection-driven delegated routing for
  that **existing** selection, and the TL correction round made **exact model selection**
  mandatory (the selected model id reaches the execution port; MSP `model/list` inspection +
  `session/start`/resume-time `modelId`/`session/setModel` verification; exec `--model`;
  visible failure when the exact model is unavailable — never a silent different-model run).
  Merge remains blocked on CI + review of the corrected heads (local runs are not CI
  evidence).

## 1. Provider identity and official documentation

- Provider: Meta Muse Code CLI (first-party local coding agent; subscription sign-in applies
  to the CLI only — a separately created Meta Model API key is pay-as-you-go even with the
  Contributor model id; per Issue #24 investigation, Meta docs at https://dev.meta.ai/docs:
  `muse-code/auth`, `muse-code/subscriptions`, `muse-code/extending`).
- Documented integration surfaces used by this work (rev. 2):
  - `muse --version` (status probe + execution-surface version gate; parsed tolerantly,
    cached in-process, probe failure = conservative fallback to the exec surface).
  - **Muse Session Protocol**: `muse serve` + the official TypeScript SDK `@muse-code/sdk`
    (npm registry, dist-tags `latest: 1.4.20`; **exact-pinned `1.4.20`** in
    `apps/zcode-cli/packages/bootstrap/package.json` — the official README states the SDK
    versions in lockstep with Muse Code, so a range pin is prohibited). Auto-selected **only
    when the installed CLI version exactly matches the pinned pairing** (rev. 3: the
    lockstep rule is X.Y.Z↔X.Y.Z, not ≥ — any deviation, newer or older, falls back to the
    exec surface; no forward-compatibility is assumed absent an official compatibility
    matrix). Meta labels this SDK **developer preview** — recorded as a known admission; the
    exec surface remains the always-available fallback.
  - `muse exec --json` with `--prompt-file` (prompt passed via temp file), the documented
    `--workspace <path>` flag (rev. 3 correction: Meta's current configuration documentation
    lists `--workspace <path>` as a common flag for interactive and headless execution — the
    earlier claim that the flag does not exist was wrong and is corrected here; MOS passes
    the MOS workspace root so the CLI-side boundary is pinned to the same policy root as the
    MOS-side lexical+physical containment check), optional `--max-model-steps`, and
    `--session-id` (documented headless session continuation) — executed as a child process
    of the CLI agent server, cwd = session working directory. The same documentation also
    lists `--model` and `--contributor-mode on|off` — scoped as follow-up work package MC-D,
    deliberately not consumed by this PR.
  - `--disable-approval` (documented unattended-approval flag; sandbox stays on) — only for
    the opt-in `unattended-sandboxed` posture.
- **Rev. 4 safety corrections (external verification round 3 / TL correction round,
  2026-11-15; ACR-0002 §Revision 4):**
  - **A (resume gate):** the durable session mapping now persists a **canonical physical
    workspace root** (`canonicalWorkspaceRoot`, realpath-resolved at mapping time) and every
    resume re-resolves the **current** request root physically against it
    (`canResumeMuseSessionMapping` in `muse-exec-support.ts`) — **no lexical same-string
    shortcut** remains (a symlink retarget keeps the string but changes the physical root);
    a mismatch or an unresolvable current root refuses the resume (fresh session inside the
    current root, `sessionWorkspaceMismatch: true`), and legacy mappings without a canonical
    root are refused too. Regression tests on both surfaces: mapping created through a
    symlink → symlink retargeted → old session refused (MSP: no `resumeSession`; exec: no
    `--session-id` in argv).
  - **B (containment):** `assertMuseWorkspaceContainment` no longer treats a **failed**
    physical resolution as a pass on the lexical verdict — ENOENT (missing cwd/root) and
    EACCES (inaccessible boundary) both reject **before spawn** with the stable issue code
    `workspaceUnresolvable` (narrow exceptions were evaluated and none justified: both
    official surfaces require an existing, resolvable root — MSP `workspaceRoots` are
    "canonical existing directory paths", exec `--workspace` needs the directory).
  - **C (MSP startup):** `startupTimeoutGate` replaces the bare `Promise.race` — a client
    resolving **after** the startup timeout is closed (SDK `close()`: 5s drain bound, then
    SIGTERM/SIGKILL escalation — no `muse serve` process remains; the SDK's
    `MuseClientSpawnOptions` has no `signal` member, so cancellable startup is not natively
    supported and the gate is the cancellation), and the **session-open phase**
    (`startSession`/`resumeSession`) is now gated too (timeout → visible failure + client
    closed by the outer `finally`; `startupTimeoutMs` is test-injectable).
- Official SDK surface verification (2026-11-14 UTC, `@muse-code/sdk@1.4.20` installed from
  the npm registry into this repo; `dist/src/*.d.ts` inspected, no local mocking): the
  adapter's usage was verified member-by-member against the shipped typings —
  `MuseClient.spawn` (`museBin`/`args`/`cwd`/`env`/`clientInfo`/`shutdownTimeoutMs`/
  `onStderr`), `startSession`/`resumeSession` (`ResumeSessionOptions.onApproval`/
  `onApprovalError` documented for approval frames that arrive with the resume reply),
  `Session.sendUserTurn`/`events`/`onApproval`/`onApprovalError`, `Turn.completed`/`items()`/
  `deltas()`/`interrupt()`, `MuseClient.readUsage`/`close`, `SessionStartParams`
  (`approvalMode` — "the only surface that declares a non-interactive run's policy";
  `workspaceRoot` / `workspaceRoots` — "every root receives the ADR `:workspace_roots`
  rules"), `ApprovalMode` (`"allowAll"` among the four documented modes), and
  `ApprovalChoice.decision` (the `denied`/`deniedPolicyAmendment`/`abort` non-approving
  decisions the fail-closed handler selects). The SDK's own documented default posture is
  deny — the fail-closed posture preserves it.
- Explicitly NOT used (prohibited by Issue #24 / ACR-0002): undocumented CLI flags
  (workspace policy is expressed via the documented `--workspace` flag on the exec surface
  plus MOS-side lexical+physical containment and Muse's own sandbox, and via MSP
  `workspaceRoot(s)`; no argv member is ever invented beyond the documented set), hidden
  OAuth/browser-session token extraction, undocumented credential databases, `--yolo` /
  sandbox disable, OpenRouter, separately billed Meta Model API keys.
- Credential handling: MOS reads, copies or displays **no** CLI credential material at any
  point. Login/Contributor state is only ever derived from observable process output of the
  user-configured, documented probe command; unknown stays unknown. Rev. 2 addition: the
  Muse child process tree receives an allowlisted environment only
  (`shared/node buildMuseChildEnv` — process bootstrap vars + user-profile dirs + locale +
  `MUSE_*` passthrough); host integration credentials (`GITHUB_TOKEN`,
  `OPENROUTER_API_KEY`, `*_SECRET`, …) are excluded by construction and asserted by fixture
  audit tests on every spawn path (exec, MSP host, version probe, status probe, login).
- **MC-D trace (rev. 5, 2026-11-15) — where the existing Composer entry comes from.** The
  external verification on the installed RC3 (built from `3832d055`, an ancestor of this
  branch's base `main@703fd7bd`) confirmed `meta/muse-spark-1.3-contributor` is selected in
  the Composer. This repository's builtin catalog (`config/provider/zcode-builtin.json`)
  ships exactly one Muse model — `muse-spark-1.2-contributor-free` under the
  `opencode-zen-chat` template (OpenCode Zen, api-key access, openai-chat-completions at
  `https://opencode.ai/zen/v1`) — and `git show 3832d055:config/provider/zcode-builtin.json`
  confirms the identical entry at RC3's commit. `meta/muse-spark-1.3-contributor` is
  therefore **not** shipped by this repository: it is a user-side provider configuration
  (provider id `meta`), and its endpoint eligibility ("0/1 endpoints eligible" — the
  account's training-policy excludes the configured endpoint) is governed by an
  account-policy layer **outside this repository** (no repo source produces that wording).
  MOS does not modify the entry, the endpoint configuration, the account policy, or any
  privacy/training setting; no credential is added. The only compliant execution route for
  that selection is the delegated CLI subscription — which is what MC-D wires.
- **MC-D discovery (rev. 5) — official MSP model surface** (`@muse-code/sdk@1.4.20`
  `dist/src/msp.d.ts` + `facade/client.d.ts`/`facade/session.d.ts`, no local mocking):
  `SessionStartParams.modelId` ("Initial model; server default when omitted"),
  `MuseClient.listModels` (`model/list`; `ModelListResult.models` is the host's
  `ModelCatalogEntry` vocabulary — `modelId`, `displayLabel`, `isActive`, `isDefault`), and
  `Session.setModel` (`session/setModel` — durable per-session selection). There is **no
  contributor-mode member** anywhere in the SDK (zero `contributor` hits across
  `dist/src`). The exec surface documents `--model` and `--contributor-mode on|off`.
  Consequence: the delegated path passes **no** model id or mode by default — the CLI runs
  under its own authenticated configuration (the user's Contributor subscription sign-in);
  per-run pinning via `--model`/`modelId` is deliberately not defaulted because the
  CLI-side model-id vocabulary cannot be verified offline (an invented id risks
  `invalidParams` rejection). Wiring per-run pinning awaits the on-machine §4 step 13.
- **MC-D routing rule (rev. 5)**: shared `isMuseDelegatedModelSelection`
  (`MUSE_DELEGATED_MODEL_ID_PATTERN = /^muse-spark-\d[\w.]*-contributor$/i`, modelId only —
  provider naming is user-side free text; the OpenCode Zen `-free` variant is deliberately
  excluded). CLI side: v4 admission routes a `sendText` / `createSession.firstInput` turn
  through the delegated backend when the envelope carries `executionBackend: "muse-code"`
  (explicit, unchanged) **or** the turn's effective selection
  (`resolveSubmittedExecutionState`: payload selection ?? session standing selection)
  matches the family **and** the shared settings file has `useAsTaskBackend: true`
  (`shouldRouteMuseDelegatedBySelection`; tolerant read, default off). Renderer side:
  `createCommandEnvelope` stamps the envelope under the same double gate **and** the
  payload's selection matching the family; the Composer selector is unlocked (selection is
  the routing input); the indicator shows active only when the current selection routes
  delegated.

## 2. Contract evidence (this repository, 2026-11-14 UTC; rev. 2 runs on the rebased head)

Mock-CLI contract suites (mocks are labeled contract-only evidence per AGENTS.md §4/§7). Rev. 2
counts (all PASS on the revision head, rebased onto `main@703fd7bd`):

- `apps/zcode-cli/packages/bootstrap/tests/muse-exec-jsonl.test.ts` — 8/8 PASS: tolerant JSONL
  mapping v2 (text delta/end, tool activity, error, approval-required and user-question
  candidates, envelope-level session-id capture from any line including unknown-typed ones),
  unknown/invalid lines counted (never guessed), summary truncation caps, versioned mapping
  table.
- `apps/zcode-cli/packages/bootstrap/tests/muse-exec-process.test.ts` — 20/20 PASS (rev. 3;
  against `tests/fixtures/muse-code/mock-muse-cli.mjs`): prompt delivered via documented
  `--prompt-file`; **documented `--workspace <workspaceRoot>` passed with the policy root
  (not the cwd) on every run (R4 rev. 3)**; cwd = session working directory; **workspace
  containment rejection before spawn when the working directory escapes the workspace root,
  including escapes through a symlink that is lexically inside but physically outside (R4)**;
  **allowlisted child environment only — host secrets (GITHUB_TOKEN/OPENROUTER_API_KEY/…)
  excluded, MUSE_* and login-state dirs preserved (R5)**; **`--disable-approval` passed only
  for the `unattended-sandboxed` posture, `--yolo` never constructed (R3)**; **session-id
  capture and documented `--session-id` resume on the next turn across a fresh port instance
  + persisted mapping, and no `--session-id` without a mapping (R2)**; **resume refused (fresh
  session + `sessionWorkspaceMismatch: true` + mapping rewritten to the current root) when
  the stored workspace root differs, and preserved across symlink aliases of the same
  physical root (R2/R4 rev. 3)**; approval/question events surfaced with counts; mapped event
  stream; unknown-event counting; nonzero exit + capped stderr surfaced; in-stream error
  events surfaced; request abort terminates the process tree and reports `cancelled`; overall
  timeout enforced; pre-aborted requests never spawn; startup failure rejects fail-closed;
  tolerant settings read.
- `apps/zcode-cli/packages/bootstrap/tests/muse-session-protocol.test.ts` — 16/16 PASS (rev.
  3; fake client/session injected through `MuseSessionProtocolDeps`): **fail-closed deny
  handler picks only server-offered non-approving choices and never approves; no
  non-approving choice offered → handler throws, approval stays open, turn bounded by
  timeout (R3)**; resume path registers the approval handler through resume options (frames
  arriving with the resume reply); `unattended-sandboxed` starts sessions with
  `approvalMode: "allowAll"` and registers no handler; **workspaceRoot passed as the single
  root when cwd == root, workspaceRoots `[cwd, root]` otherwise (R4)**; workspace containment
  violation rejects before host spawn, **including symlink escapes that are lexically inside
  but physically outside (R4 rev. 3)**; **durable session mapping written on observe, resumed
  on the next run, write-failure degrades to "not resumable this turn" without failing the
  completed turn (R2)**; **resume refused (startSession in the current root +
  `sessionWorkspaceMismatch: true`) when the stored workspace root differs, and preserved
  across symlink aliases of the same physical root (R2/R4 rev. 3)**; text deltas streamed with
  a fold-text fallback when no delta frames arrive; tool items projected as started and
  settled at turn end; token usage mapped from `turn/completed` and subscription usage
  snapshot read best-effort (R6); timeout/cancel interrupt the turn and settle honestly; host
  startup timeout rejects fail-closed; the host is closed with a bounded drain on every exit
  path.
- `apps/zcode-cli/packages/bootstrap/tests/muse-exec-support.test.ts` — 11/11 PASS (new,
  rev. 3): lexical root comparison normalization (separators, trailing separators, win32
  device-path prefixes, empty roots never equal); **realpath alias resolution keeps
  continuity across symlinked roots and fails closed (different) when either root cannot be
  resolved**; **Windows junction semantics simulated through the injectable realpath (alias
  ↔ target same physical root = resume; different physical root = refuse)**; containment's
  physical re-check rejects lexically-inside/physically-outside escapes, allows symlinks
  that stay inside the root, and falls back to the lexical verdict when resolution is
  unavailable.
- `apps/zcode-cli/packages/core/tests/delegated-muse-turn.test.ts` — 8/8 PASS (rev. 3):
  text via standard `ModelStreaming` events; tool activity via `ToolCallStarted`/
  `ToolCallResult`; persists assistant message (providerId `muse-code`, modelId `muse-exec`,
  finish `muse_turn_complete`) + full text part (cold-resume visible); **`cost: null` +
  `usageReporting: "unreported"` metadata + mapped token usage when the port reports it
  (R6)**; **workspace-mismatch continuity resets attributed in message metadata
  (`museExecution.sessionWorkspaceMismatch`, R2 rev. 3)**; **approval requests and user
  questions projected as visible activity rows with reconciled counts (R3)**; cancellation
  persists partial text + `turnResult: "cancelled"`; nonzero exit and in-stream errors fail
  the turn (with approval-observed hints); missing port fails closed with
  `ZCODE_MUSE_EXEC_UNAVAILABLE`.
- `packages/services/test/museCodeService.test.ts` — 7/7 PASS (rev. 2): version probe
  parsing; fail-closed unavailable status; user-configured status-probe parsing (JSON)
  without guessing unknown fields; settings persistence + cache invalidation + schema
  rejection; login launch gated on the configured documented command; **execution-surface
  prediction shares the port's `selectMuseExecutionSurface` (version unknown → exec
  fallback; **exact lockstep pin match required for the MSP prediction — newer/older/
  prerelease-suffixed versions all predict the exec fallback, rev. 3)**); **probes/launch run
  under the allowlisted child environment (R5)**.
- `packages/ui/test/museCodeBackendStamp.test.ts` — 3/3 PASS: envelope `executionBackend`
  stamped on `createSession`/`sendText` only when both gates (user intent + session CLI
  capability) are open; never on other commands; never when either gate is closed.

Rev. 3 verification run (2026-11-15 UTC, corrected head): the seven muse suites re-run green
— bootstrap JSONL 8/8, process 20/20, MSP 16/16, support 11/11 (new), core delegated-turn
8/8, services 7/7, ui stamping 3/3 (**73/73 total**); `pnpm --filter @zcode/bootstrap...`
build clean against the installed real `@muse-code/sdk@1.4.20` (the exact-match gate does
not change the SDK pin; it only changes when the MSP surface is auto-selected). The full
repo gate chain on the corrected head is recorded below in §2b.

Rebase note (2026-11-15, post-rev. 4): `main` moved under the stack (`703fd7bd` → `a81c9414`
via the PR #29 fresh-install-fixture merge; the only overlap with this work is the shared
`docs/handoff/IMPLEMENTATION-STATE.md` append — both records preserved). Both branches were
rebased (`tl/muse-code-delegated-backend` → `63adcf74`, `tl/muse-code-mc-d-selection` →
`26c29a4d`) and the full `verify:pre-push` chain was re-run green on each rebased head
(architecture `--changed` 0 violations; release 72/72 — PR #29's fixture tests included; the
affected selector chose the entire 237-file engineering suite and deferred execution to CI
per its design), plus the muse suites re-run green on the rebased MC-D head (bootstrap
muse 60/60, core delegated-turn 8/8, services 10/10, ui stamping 6/6). GitHub CI on the
rebased pushed heads remains the merge-blocking authority.

Rev. 4 verification run (2026-11-15 UTC, MC-D head): the muse suites re-run green —
bootstrap JSONL 8/8, process 20/20, MSP 16/16, support 11/11, **delegated routing 5/5
(new: family + settings gate + shared settings-file read + fail-closed default)**, core
delegated-turn 8/8, services **10/10** (+3: family matcher — existing Contributor
selection across provider names, free-variant/ordinary exclusion, fail-closed missing
selections), ui stamping **6/6** (rewritten: model-aware stamping for
createSession.firstInput/sendText, ordinary/free-variant non-stamping, no-selection
non-stamping, both gates, indicator mirror) — **84/84 total**; regressions green (bootstrap
v4 suite 711/711; command-inbox + session-resident-pool + queue-input-fidelity +
create-session-command-fact 88/88; core turn suites 52/52); builds green (`tsc -b` shared/
services/client/ui — the ui pass needed `NODE_OPTIONS=--max-old-space-size=3000` on this
4 GB verification host, recorded as an environment note, not a code issue; `pnpm --filter
@zcode/bootstrap... build` clean).

Regression (same environment, revision head): core turn/admission suites 60/60 PASS; core
delegated-turn 7/7; **full bootstrap v4 command suite 725/725 PASS (29 files)**; architecture
governance 61/61 PASS; `tsc -b` clean for shared, services, client, ui; `pnpm --filter
@zcode/bootstrap... build` clean (contracts/core/bootstrap/adapters/i18n against the installed
real `@muse-code/sdk@1.4.20` — the MSP adapter compiles against the shipped SDK typings, not
a local stub). Architecture check delta vs `main`: zero new violations (10 pre-existing
`missing-module-artifact` violations exist identically on `main`, verified by stashing the
working tree and re-running). Repo gates: `pnpm lint` PASS (0 errors); stale-doc-phrase check
PASS (2303 files); SQLite schema contract check PASS. Full engineering suite (`pnpm
test:engineering`, 237 specs — the CI affected-selection for this diff selects the entire
suite): result recorded below in §2a. GitHub CI on the pushed head remains the merge-blocking
authority (local runs are not CI evidence).

Fresh-environment reproduction (2026-11-15 UTC, clean clone at the guardrail head `1f617b73`,
fresh `pnpm install` from the lockfile): the six muse suites re-run green — bootstrap JSONL
8/8, process 16/16, MSP 13/13, core delegated-turn 7/7, services 7/7, ui stamping 3/3
(**54/54 total**, matching the recorded total; the rev. 2 record's per-file split had
transposed the JSONL/MSP counts as 6/15 — corrected above, totals unchanged); `pnpm --filter
@zcode/bootstrap... build` clean against the freshly installed real `@muse-code/sdk@1.4.20`,
and the adapter's SDK surface re-verified member-by-member against the shipped typings
(`MuseClient.spawn`/`MuseClientSpawnOptions.env`, `StartSessionOptions`
`workspaceRoot`/`workspaceRoots` + `approvalMode: "allowAll"`, `ApprovalDecision`
`denied`/`deniedPolicyAmendment`/`abort`, `Session.events`/`sendUserTurn`/`onApproval`, turn
`completed`/`items`/`deltas`/`interrupt`, `readUsage`).

### 2a. Full engineering suite (rev. 2 head, 2026-11-14 UTC, chunked local run)

`pnpm test:engineering` executed chunked (10 sequential chunks, 237 spec files, every file in
`scripts/engineering-test-files.json`): **237 files executed — 234 passed, 2 intentional
file-level skips, 1 failed; 1,894 tests — 1,885 passed, 8 skipped (intentional), 1 failed.**
The single failing file is `packages/desktop/test/miseToolchainEnv.test.ts` — the exact
environment-sensitive baseline documented in `.github/workflows/mos-ci.yml` header note 4
(hosts where Node lives at `/usr/bin`; this verification host has Node at `/usr/bin/node`,
the CI runner's Node is under the toolcache path). The failure is a PATH-dedup assertion
against `dirname(process.execPath)` colliding with the literal `/usr/bin` fixture entry —
untouched by PR #27 (the file imports `scripts/mise-toolchain-env.mjs`; no PR #27 path is
involved). Zero engineering failures relate to PR #27's changed files. One chunk needed the
`@zcode/e2e-report` workspace package built first (unbuilt-workspace environment issue, not a
code failure; the chunk was re-run green after `pnpm --filter @zcode/e2e-report... build`).

### 2b. Verification chain on the rev. 3 corrected head (2026-11-15 UTC, `d8ff2bf`)

Full `pnpm run verify:pre-push` on the committed correction head (with the pre-push hook
stdin `refs/heads/tl/muse-code-delegated-backend d8ff2bf… 843ac58e…`), exit green end to
end: push-worktree check; e2e-remote-targets check; `pnpm lint` (oxlint +
session-control-boundary) PASS; stale-doc-phrase check PASS; SQLite schema contract check
PASS; architecture governance tests **61/61 PASS**; `architecture:check -- --changed`
(merge-base `origin/main`) **0 violations (baseline 0, new 0)**; affected engineering
selection for the push range (`843ac58e..d8ff2bf`) — **43/237 files selected by the official
source-graph, 279 passed + 2 intentional skips, 0 failed**; release tests **51/51 PASS**.

Additional local regression on the corrected head (beyond the muse suites in §2): the
bootstrap v4 command-suite family — `tests/v4-*` (27 files, 711 tests) plus
`command-inbox` + `session-resident-pool` (2 files, 81 tests) = **29 files / 792 tests,
all PASS**; core turn suites (`turn-*` + delegated-muse-turn) — **6 files / 52 tests
PASS**; `tsc --noEmit` clean for `@zcode/core` and `@zcode/bootstrap` (test files included);
`pnpm --filter @zcode/bootstrap... build` clean against the installed real
`@muse-code/sdk@1.4.20`.

The full 237-file engineering selection for the PR diff vs `main` (the CI affected-selection
that rev. 2 recorded chunked locally) is on this round validated by GitHub CI on the pushed
head — per this record's standing rule, local runs are not CI evidence and CI remains the
merge-blocking authority. The rev. 2 chunked local run (§2a) plus the 43-file push-range
selection and the targeted regressions above cover the rev. 3 delta (additive result field,
muse-module-internal changes, exact-gate decision rule shared with the services preview).

### 2c. Safety-correction regression coverage (rev. 4 head, 2026-11-15 UTC)

On the rev. 4 corrected head, the muse contract suites all pass:
`tests/muse-exec-jsonl.test.ts` (8), `tests/muse-exec-process.test.ts` (24, including the
retarget/legacy-mapping resume refusals), `tests/muse-session-protocol.test.ts` (20,
including the retarget refusal, the unresolvable-boundary rejection, the late-client close
and the hanging session-open), `tests/muse-exec-support.test.ts` (14, including
`canResumeMuseSessionMapping` retarget/alias/legacy/ENOENT/EACCES and containment
ENOENT/EACCES) — **66/66 PASS**; core `tests/delegated-muse-turn.test.ts` — **8/8 PASS**.
(The full `verify:pre-push` chain and GitHub CI re-run on the final pushed head remain the
merge-blocking authority, per this record's standing rule.)

## 3. Known limitations (honest boundaries; rev. 2)

- The exact JSONL event schema of the installed `muse exec --json` build has **not** been
  observed in this environment. The mapping table is a versioned candidate
  (`MUSE_EXEC_JSONL_MAPPING_VERSION = 2`); unmapped lines are counted, never guessed. The
  **MSP surface (auto-selected only when the CLI version exactly matches the pinned SDK
  version, rev. 3) does not depend on this candidate mapping** — it consumes the official
  SDK's typed fold. The on-machine run in §4 must still capture sanitized JSONL samples and
  reconcile the exec-surface mapping (bump the version + add cases) if field names differ.
- The exec surface's session-id claim depends on a candidate envelope field
  (`session_id`/`sessionId`/nested `session.id`) in the JSONL stream; if the real CLI
  declares it under a different name, continuity silently degrades to fresh sessions per
  turn (never an invented id) until §4 reconciles the envelope reader. The MSP surface
  reads the session id from the SDK's typed session objects and has no such dependency.
- The `@muse-code/sdk` is a **developer preview** (Meta's own label) and versions in
  lockstep with the CLI — **exact X.Y.Z↔X.Y.Z pairing (rev. 3)**: the auto gate selects the
  MSP surface only when `muse --version` exactly equals `MUSE_CODE_SDK_PINNED_VERSION`
  (`1.4.20`, bare x.y.z; prerelease/build suffixes do not match). When the user upgrades the
  CLI past the pin, delegated turns conservatively fall back to the exec surface until the
  pin is bumped in lockstep; `MUSE_CODE_SDK_PINNED_VERSION` is the single knob, and an
  explicitly configured `executionSurface` remains available for on-machine diagnosis.
- MSP-surface boundary: `session/start` has no `--max-model-steps` equivalent member —
  `request.maxModelSteps` is ignored on the MSP surface (the exec surface still honors it);
  runaway steps are bounded by the overall timeout.
- Session continuity is workspace-scoped (rev. 3): the durable map records the workspace
  root used when the mapping was established; a resume is attempted only when the stored
  root and the current request root are the same — lexically, or through realpath alias
  resolution (symlinks / Windows junctions pointing at the same physical directory keep
  continuity). A different physical root refuses the resume: a fresh Muse session starts
  inside the current root (self-healing mapping rewrite) and the turn result/metadata/log
  carry `sessionWorkspaceMismatch: true` so the reset is attributable, never silent.
- Model pinning boundary (rev. 5 / MC-D): the delegated path passes **no** model id or
  contributor-mode flag by default — the CLI runs under its own authenticated configuration
  (the Contributor subscription sign-in). The official MSP surface has `modelId` at
  `session/start` (+ `model/list`/`session/setModel`) and the exec surface documents
  `--model` / `--contributor-mode on|off`, but the CLI-side model-id vocabulary is not
  verifiable offline; wiring per-run pinning awaits the on-machine §4 step 13.
- Training-policy preservation (rev. 5 / MC-D): MOS does not modify the account's
  training-policy settings, the user-side `meta` provider entry, its endpoint
  configuration, or any privacy setting, and adds no credential. The blocked HTTP endpoint
  failure for the Contributor selection remains the honest status quo when the delegated
  backend is disabled; the delegated path is the only compliant execution route and uses
  the CLI's own subscription sign-in.
- Sign-in / Contributor state requires the user to record the documented status command
  (from `muse --help`) under Settings → Meta Muse Code → Advanced. Until then the status
  card honestly shows "unknown".
- Delegated turns require an idle session with immediate delivery (no steer/queue). Inputs
  under busy/queue/guide/choice routing are rejected before ACK with an actionable message
  instead of silently rerouting.
- Windows `.cmd`/`.bat` npm shims are not spawned (no shell); users must provide the native
  executable path (or the shim's real target) in settings.
- Session title generation and Memory extraction are skipped for delegated turns (they
  require a provider Model); session title falls back to first-input title.
- Subscription usage (`usage/read` window/weekly percentages) is surfaced best-effort from
  the MSP surface only; the exec surface reports no usage, and the turn cost is recorded as
  `null` (unreported) on both surfaces — never `0`.
- Roadmap guardrail (review item 7): Muse Code is an **optional host capability** — opt-in
  and capability-gated with default paths unchanged; no market-intelligence feature depends
  on it; delegated execution stays scoped to New Task sessions. See ACR-0002 §Revision 2
  (roadmap guardrail) for the normative statement.

## 4. On-machine verification checklist (Issue #24 §5; blocks any `verified` status)

Execute on the user's Windows x64 machine with the real signed-in Muse Code CLI; append
results with UTC timestamps (sanitize all samples: no tokens, no env dumps).

1. Record `muse --version` and `muse --help` output (sanitized). If a documented auth/status
   command exists, record it and set it under Settings → Meta Muse Code → Advanced, then
   Recheck and record the parsed badges (signed-in / Contributor). **Rev. 2:** record which
   execution surface the settings card predicts (Session Protocol when the CLI version
   **exactly matches** `@muse-code/sdk`'s pinned `1.4.20` — rev. 3 — else `muse exec`).
2. Enable "Use Muse Code as the New Task backend" in Settings → Meta Muse Code; confirm the
   Composer indicator appears and **model selection is disabled with the explicit "tasks
   will run on Muse Code" lock reason** (R6).
3. Create a real New Task from Composer in the active workspace; confirm the task streams
   assistant text and tool activity rows in the ordinary session view. **Rev. 2:** record
   the turn's actual `surface` (session-protocol / muse-exec) from the completed-turn log
   line (`muse_delegated_turn.completed`), the Muse session id, and whether the turn
   reported token usage + the subscription window snapshot (MSP) or `usageReporting:
   "unreported"` with `cost: null` (R6).
4. **Rev. 2 (R2):** send a second turn in the same MOS session; confirm from the log line
   that `resumedMuseSession: true` and the Muse session id is unchanged; restart MOS and
   repeat — the mapping file (`~/.zcode/v2/muse-code-sessions.json`) must keep the
   continuity across restarts (each entry now also carries `canonicalWorkspaceRoot`, the
   realpath-resolved root at mapping time). **Rev. 3:** re-open the same MOS session against a different
   workspace root and confirm the turn runs with `resumedMuseSession: false` +
   `sessionWorkspaceMismatch: true` in the completed-turn log line (fresh Muse session inside
   the new root; continuity reset is visible, not silent). Optionally repeat with the same
   physical root reached through a symlink/junction alias and confirm continuity is kept.
   **Rev. 4 (A):** create the mapping through a symlink/junction, retarget that link to a
   different physical workspace, and send the next turn **through the identical path
   string** — confirm the old Muse session is refused (`resumedMuseSession: false` +
   `sessionWorkspaceMismatch: true`) and a fresh session runs inside the (new) current root.
5. Press Stop mid-task; confirm the turn settles as interrupted (TurnComplete cancelled)
   and the CLI process tree is gone (no orphan `muse`/`muse serve` processes). **Rev. 4 (C):**
   also confirm no orphaned `muse serve` remains after any failed/hung startup (e.g. an
   aborted connect or a version-mismatched CLI that stalls the Session Protocol handshake):
   a late- or never-starting host must be closed by MOS, not leaked.
6. Confirm MOS Studio mission linkage still attaches (mission sidecar SessionStart hook) and
   the session transcript survives an app restart (cold resume renders the delegated turn).
7. **Rev. 2 (R3):** with the default `fail-closed` posture, run a task that would require a
   tool approval; confirm the approval is visible as an activity row, is never approved by
   MOS, and the turn either completes without the approved action or fails with the
   approval-observed hint. Optionally repeat with `unattended-sandboxed` (sandbox stays on)
   and confirm the sandbox still blocks out-of-workspace writes. Never configure `--yolo`.
8. **Rev. 2 (R4):** confirm the delegated session's working directory stays inside the
   workspace root (any attempt to run outside must reject with the workspace-violation
   message before any spawn). **Rev. 3:** confirm the exec-surface child receives the
   documented `--workspace <workspace-root>` argument (e.g. via the CLI's own argv-debug
   facility or a wrapper) pinned to the same policy root, and that a working directory that
   is lexically inside the root but resolves (symlink / junction) outside is rejected before
   spawn. **Rev. 4 (B):** confirm a working directory or workspace root that **cannot be
   physically resolved** (deleted mid-session, inaccessible) is rejected **before spawn**
   with the "could not resolve the workspace boundary physically" message — it must never
   fall back to a lexical pass.
9. **Rev. 2 (R5):** with the backend enabled, run a task and confirm the CLI child process
   environment contains no host integration secrets (spot-check on the target machine with
   the CLI's own env-debug facility or a wrapper; MOS never passes them).
10. Confirm no OpenRouter traffic and no Meta Model API key path is involved (the session
    message attribution is `muse-code/muse-exec`; provider settings unchanged).
11. Capture a sanitized JSONL event sample from `muse exec --json` (force the `muse-exec`
    surface in Settings → Advanced for this run) and reconcile `muse-exec-jsonl.ts` —
    especially the envelope session-id field for R2 (bump
    `MUSE_EXEC_JSONL_MAPPING_VERSION` if needed; add parser tests).
12. Record CLI version, MOS build, and OS; attach sanitized screenshots of the settings card
    and a completed delegated task.
13. **Rev. 4 (MC-D):** with the backend toggle on, select the existing Muse Spark Contributor
    model in the Composer and send a New Task — confirm from the completed-turn log line
    (`muse_delegated_turn.completed`) that the turn ran with `surface` set and that no
    OpenRouter / Meta Model API request was made (the policy-blocked endpoint is never
    reached); switch to an ordinary model and confirm the turn runs the ordinary model path
    (selector stays usable). In a Studio mission-linked session with the Contributor model
    selected, confirm the same delegated routing. Optionally record `model/list` output
    (sanitized) to decide whether per-run `--model`/`modelId` pinning can be wired safely
    (evidence §1 MC-D discovery; no invented ids).

## 5. Rollback

Disable the backend toggle in Settings (renderer stops stamping the envelope; behavior
returns to the standard model path immediately). Full revert = revert this PR; no data
migration, no credential residue.
