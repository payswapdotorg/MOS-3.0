# Muse Code delegated backend evidence record

Issue #24 / ACR-0002. Evidence vocabulary follows AGENTS.md §7 strictly.

## Status (AGENTS.md §7 vocabulary only)

- Backend integration (delegated turn executor + Host service + settings UI): **contract-tested**
  (mock-CLI contract suites below; real `muse` CLI not present in this environment).
- Real provider execution (real Muse Code CLI task on the user's Windows machine): **planned**
  — checklist in §4 must be executed on the target machine and its evidence appended here
  before any status may be raised to `integrated` or `verified`.
- OpenRouter / Meta Model API routes: unchanged; the free `muse-spark-1.2-contributor-free`
  Zen model entry in the builtin provider catalog is not modified by this work.

## 1. Provider identity and official documentation

- Provider: Meta Muse Code CLI (first-party local coding agent; subscription sign-in applies
  to the CLI only — a separately created Meta Model API key is pay-as-you-go even with the
  Contributor model id; per Issue #24 investigation, Meta docs at https://dev.meta.ai/docs:
  `muse-code/auth`, `muse-code/subscriptions`, `muse-code/extending`).
- Documented integration surface used by this work:
  - `muse --version` (status probe; parsed tolerantly).
  - `muse exec --json` with `--prompt-file` (prompt passed via temp file) and optional
    `--max-model-steps` (executed as a child process of the CLI agent server, cwd = session
    working directory).
- Explicitly NOT used (prohibited by Issue #24 / ACR-0002): undocumented CLI flags, hidden
  OAuth/browser-session token extraction, undocumented credential databases, `--yolo` /
  sandbox disable, OpenRouter, separately billed Meta Model API keys.
- Credential handling: MOS reads, copies or displays **no** CLI credential material at any
  point. Login/Contributor state is only ever derived from observable process output of the
  user-configured, documented probe command; unknown stays unknown.

## 2. Contract evidence (this repository, 2026-11-14 UTC)

Mock-CLI contract suites (mocks are labeled contract-only evidence per AGENTS.md §4/§7):

- `apps/zcode-cli/packages/bootstrap/tests/muse-exec-jsonl.test.ts` — 6/6 PASS:
  tolerant JSONL mapping (text delta/end, tool activity, error), unknown/invalid lines are
  counted (never guessed), summary truncation caps, versioned mapping table.
- `apps/zcode-cli/packages/bootstrap/tests/muse-exec-process.test.ts` — 10/10 PASS
  (against `tests/fixtures/muse-code/mock-muse-cli.mjs`): prompt delivered via documented
  `--prompt-file`; cwd = session working directory; mapped event stream; unknown-event
  counting; nonzero exit + capped stderr surfaced; in-stream error events surfaced; request
  abort terminates the process tree and reports `cancelled`; overall timeout enforced;
  pre-aborted requests never spawn; startup failure rejects fail-closed.
- `apps/zcode-cli/packages/core/tests/delegated-muse-turn.test.ts` — 5/5 PASS: delegated
  turn projects text via standard `ModelStreaming` events, tool activity via
  `ToolCallStarted`/`ToolCallResult`; persists assistant message (providerId `muse-code`,
  modelId `muse-exec`, finish `muse_turn_complete`) + full text part (cold-resume visible);
  cancellation persists partial text + `turnResult: "cancelled"`; nonzero exit and in-stream
  errors fail the turn; missing port fails closed with `ZCODE_MUSE_EXEC_UNAVAILABLE`.
- `packages/services/test/museCodeService.test.ts` — 6/6 PASS: version probe parsing;
  fail-closed unavailable status; user-configured status-probe parsing (JSON) without
  guessing unknown fields; settings persistence + cache invalidation + schema rejection;
  login launch gated on the configured documented command.
- `packages/ui/test/museCodeBackendStamp.test.ts` — 3/3 PASS: envelope `executionBackend`
  stamped on `createSession`/`sendText` only when both gates (user intent + session CLI
  capability) are open; never on other commands; never when either gate is closed.

Regression (same environment): core turn/admission suites 63/63 PASS; bootstrap v4 command
suites 81/81 PASS; architecture governance 61/61 PASS; `tsc -b` clean for shared, services,
client, ui; core/bootstrap package builds clean. Architecture check delta vs `main`: zero
new violations (10 pre-existing `missing-module-artifact` violations exist identically on
`main`).

## 3. Known limitations (honest boundaries)

- The exact JSONL event schema of the installed `muse exec --json` build has **not** been
  observed in this environment. The mapping table is a versioned candidate
  (`MUSE_EXEC_JSONL_MAPPING_VERSION = 1`); unmapped lines are counted, never guessed. The
  on-machine run in §4 must capture sanitized samples and reconcile the mapping (bump the
  version + add cases) if field names differ.
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

## 4. On-machine verification checklist (Issue #24 §5; blocks any `verified` status)

Execute on the user's Windows x64 machine with the real signed-in Muse Code CLI; append
results with UTC timestamps (sanitize all samples: no tokens, no env dumps).

1. Record `muse --version` and `muse --help` output (sanitized). If a documented auth/status
   command exists, record it and set it under Settings → Meta Muse Code → Advanced, then
   Recheck and record the parsed badges (signed-in / Contributor).
2. Enable "Use Muse Code as the New Task backend" in Settings → Meta Muse Code; confirm the
   Composer indicator appears.
3. Create a real New Task from Composer in the active workspace; confirm the task streams
   assistant text and tool activity rows in the ordinary session view.
4. Press Stop mid-task; confirm the turn settles as interrupted (TurnComplete cancelled) and
   the CLI process tree is gone (no orphan `muse` processes).
5. Confirm MOS Studio mission linkage still attaches (mission sidecar SessionStart hook) and
   the session transcript survives an app restart (cold resume renders the delegated turn).
6. Confirm no OpenRouter traffic and no Meta Model API key path is involved (the session
   message attribution is `muse-code/muse-exec`; provider settings unchanged).
7. Capture a sanitized JSONL event sample from `muse exec --json` and reconcile
   `muse-exec-jsonl.ts` (bump `MUSE_EXEC_JSONL_MAPPING_VERSION` if needed; add parser tests).
8. Record CLI version, MOS build, and OS; attach sanitized screenshots of the settings card
   and a completed delegated task.

## 5. Rollback

Disable the backend toggle in Settings (renderer stops stamping the envelope; behavior
returns to the standard model path immediately). Full revert = revert this PR; no data
migration, no credential residue.
