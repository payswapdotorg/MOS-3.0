# ZCode preservation contract

**Purpose:** Prevent the MOS fork from regressing into a different application or losing general-purpose ZCode functionality.

## 1. Baseline

Preservation baseline is the exact pinned ZCode commit in spec/architecture/source-baselines.yaml. The TL must generate and commit a feature inventory from that source before MOS code changes.

## 2. Required preserved capabilities

The checklist must be reconciled to actual source at the pinned SHA. At minimum, test and preserve:

- Existing New Task entry, controls, draft behavior, submit behavior and attachment handling.
- Composer, prompt input, model/provider selector, reasoning/mode/plan controls and keyboard behavior.
- Existing conversations, task/session history, projects/workspaces and resume behavior.
- Model providers and settings; user can continue to choose the model/provider.
- AgentRuntime, subagents, tools, tool search/deferred exposure and tool approval.
- Permissions, confirmation dialogs and safety controls.
- Plugins, MCP stdio/HTTP/SSE transports, OAuth, Skills, Commands, Hooks and marketplace lifecycle.
- Extension host contributions and UI plugin bridge.
- Dynamic Workflow, background jobs, scheduler, off-peak work, bots and channels.
- Browser and computer-use features.
- Files, attachment access, terminal, Git and workspace behavior.
- Desktop, web and remote workspace transports.
- Existing preferences, theme, accessibility, localization, packaging and update flows.
- Existing telemetry, diagnostics, error handling and test harnesses.

## 3. Explicit prohibitions

- No New Task control may be removed, hidden, renamed in a way that breaks existing navigation/tests, or replaced by a MOS-only control.
- No original ZCode function may be removed merely because MOS provides an alternative.
- No global navigation rewrite, replacement side rail, shell redesign, forced marketing dashboard or new app entrypoint.
- No replacement Next.js application or second React root used as the product shell.
- No forced MOS onboarding or provider connection for generic ZCode usage.
- No provider model selector removal or silent model switching.
- No replacing the generic session store with MOS mission state.
- No replacing plugin/MCP/skill/command/hook infrastructure with a MOS-only registry.
- No weakening tests, permissions or trust boundaries to accommodate MOS.

## 4. Safe additive pattern

- Add MOS module contracts first.
- Link a MOS mission to an existing ZCode session/task using a nullable, versioned association; do not fork or duplicate the conversation record.
- Add mission context via a small sidecar/context panel or existing extension slot.
- Add MOS intent detection after the existing task-intake boundary, preserving normal prompt and controls.
- If intent parsing fails, times out, or is declined, create/run the standard ZCode task normally.
- Keep MOS controls clearly labeled and separable; no existing button behavior changes.
- Use feature flags and staged rollout for new UI and orchestration.
- Keep original plugin manager behavior and manifest schema unchanged; MOS capability metadata is additive.

## 5. Required regression suite

The TL records a passing upstream baseline first. After every integration, rerun the relevant upstream tests and add preservation tests.

| Journey | Required proof |
|---|---|
| Start ordinary New Task | Existing controls visible and functional; task created without MOS connection |
| Start MOS-assisted New Task | Same original controls; MOS context linked additively; standard session remains intact |
| Choose model/provider | User selection respected; no silent reroute |
| Continue old session | History/resume unchanged; MOS sidecar does not corrupt it |
| Install/manage existing plugin | Existing lifecycle/schema remains compatible |
| Use MCP/Skill/Command/Hook | Existing behavior and approvals still operate |
| Approve/reject a tool | Original permission boundary unchanged; MOS cannot bypass |
| Run workflow/subagent | Existing runtime works; MOS graph compiles to it without parallel executor |
| Use browser/files/terminal/Git | Existing tool surfaces remain accessible |
| Use web/desktop/remote | Each original client builds and critical flows remain |

## 6. Diff audit

For every PR touching shared packages, attach:
- deleted/renamed control audit;
- route/navigation diff;
- public API/type diff;
- permission/auth diff;
- upstream test comparison;
- changed files and rationale;
- rollback/feature-flag path.

A green MOS test suite is insufficient if any existing ZCode journey regresses.
