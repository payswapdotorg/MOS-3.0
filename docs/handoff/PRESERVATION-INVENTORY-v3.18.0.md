# Preservation inventory — ZCode v3.18.0 substrate

**Generated:** 2026-11-12 (Stage 0 source takeover)
**Source pin:** b95ebaffeab641907b38652f45c1502bd762972d (tree d7ebeb994cb8f46b16761fc9c550ae3f6e039c3d)
**Import merge:** 545910f3ecf4ebc149c690c3bb7b77124e1e747e (tree e18bc2ea182da7b1b9efec62a818574d57ac0663)
**Purpose:** map every area of `spec/architecture/preservation-contract.md` §2 to real paths observed in the imported tree, per `FINAL-TL-HANDOFF-WEEK-1.md` §2.5. Paths listed below were verified to exist at the pin. This is the input for the initial preservation test matrix; it is not itself a test.

## Workspace layout at the pin

- **packages (24):** android, client, design-runtime, desktop, e2e-report, formal-proof, model-option-map, plugin-api, provider, provider-node, rpc, server, services, session-control, share-ui, shared, stream-animate, ui, web, web-share, zcode-cua, zcode-server-cli
- **apps (2):** dev-docs, zcode-cli
- **Root test infra:** vitest.config.ts, vitest.setup.ts, scripts/test/*.mjs (node --test governance suites), 2096 test/spec files tree-wide
- **CI at the pin:** none — the upstream snapshot ships no `.github/` workflows (recorded; nothing to preserve there)

## Area → verified source paths

| Preservation area (contract §2) | Verified real paths at the pin |
|---|---|
| New Task entry/controls/draft/submit/attachments | `packages/ui/src/NewTaskButtonGroup.tsx` (handoff §6A path VERIFIED), `packages/services/src/session/zcodeTaskService.ts`, `packages/services/src/session/zcodeTaskListTypes.ts`, `packages/services/src/session/legacyTaskSessionFile.ts`, `packages/services/src/task-groups/*` |
| Composer, prompt input, model selector, modes | `packages/ui/src/v4/composer/V4ComposerToolbar.tsx` (handoff §6A path VERIFIED), `packages/model-option-map/*`, `packages/services/src/session/sessionModeOptions.ts`, `packages/services/src/bots/modelSelectionHelpers.ts`, `packages/services/src/subagents/subagentModelSelection.ts` |
| Conversations, session history, resume | `packages/services/src/session/*` (incl. `tasksDatabase/` schema v1–v5, `claude-native/` import), `packages/services/src/zcode-session/*`, `packages/session-control/*`, `packages/services/src/task-facts/*` |
| Model providers/settings; user choice preserved | `packages/provider/*`, `packages/provider-node/*`, `packages/services/src/model-provider/*` (incl. `accountProviderCredentialService.ts`, `providerFacadeServices.ts`, `providerSettingsConnectivity.ts`), `packages/services/src/usage-stats/*`, `packages/services/src/coding-plan-subscription/*` |
| AgentRuntime, subagents, tools, deferred discovery, approvals | `packages/services/src/subagents/*`, `packages/services/src/zcode-agent/*` (runtime/process manager, protocol transport, tool policy: `automationToolPolicy.ts`, plan support: `independentPlanSupport.ts`), `packages/services/src/session/toolPlanAdapter.ts`. Note: the literal `ToolSearch` name from handoff §6B is not present in v3.18.0; deferred tool exposure is implemented via the session tool-plan surfaces above — reconcile exact entry points during W1-B/W1-C path assignment before editing |
| Permissions, confirmations, safety | `packages/services/src/credential/*` (credential cipher), `packages/services/src/oauth/oauthUnauthorizedRequest.ts`, `packages/services/src/cua-permission-broker/cuaAgentAdmissionGate.ts`, `packages/services/src/zcode-agent/automationToolPolicy.ts`, `packages/services/src/extensions/grantsStore.ts` + `grants/` |
| Plugins, MCP (stdio/HTTP/SSE), OAuth, Skills, Commands, Hooks, marketplace lifecycle | `packages/plugin-api/src/*` (manifest.ts, contract.ts, protocol-v4.ts, sessions.ts), `packages/services/src/plugins/*` (pluginsService, pluginManagement, officialPluginCache), `packages/services/src/plugin-sync/*`, `packages/services/src/mcp-sync/*`, `packages/services/src/official-mcp/*` (officialMcpCredentials, issuanceAudit), `packages/services/src/oauth/*` (oauthService, providers/*, repo/oauthCredentialRepo), `packages/services/src/skills/*` + `skill-sync/*`, `packages/services/src/commands/*`, `packages/services/src/hooks/*`, `packages/services/src/data-sync/*` (mcp/skill/command/hook/subagent/plugin data sync) |
| Extension host contributions and UI plugin bridge | `packages/services/src/extensions/*` (manifestReader, capabilityGateway, grants, viewRelay, sessionControls), `packages/services/src/plugin-ui-bridge/*` (contract, appToolsContract, instanceAccounts) |
| Dynamic Workflow, background jobs, scheduler, off-peak, bots, channels | `packages/services/src/session/automationCron.ts`, `automationRepo.ts`, `automationService.ts`, `automationIntervalCarrier.ts`, off-peak: `offPeakTask*`, `offPeakServerClient.ts`, `offPeakRuntimeModel.ts`; bots/channels: `packages/services/src/bots/*` (feishu/weixin/telegram providers, channel runtimes, topic history), `packages/services/src/bot-project-runtime/*`, `packages/services/src/zcode-agent/zcodeAgentWorkflowParams.ts`, `packages/services/src/managed-worktree-tasks/*` |
| Browser and computer-use | `packages/zcode-cua/*` — v3.18.0 ships an API-compatible fail-closed placeholder (`zcodeCuaPlaceholder: true`; every runtime surface reports unavailable), `packages/services/src/cua-permission-broker/*` (incl. PIP session, admission gate), `packages/services/src/zcode-agent/zcodeAgentBrowserAmbientContext.ts` |
| Files, attachments, terminal, Git, workspace | `packages/services/src/file/*` (fileService, workspaceFileSearch, mention filter), `packages/services/src/fs/*`, `fileWatcher/*`, `packages/services/src/terminal/*` (terminalService, node-pty), `packages/services/src/git/*` (gitCheckpointService, managed-worktree/, repo/), `packages/services/src/project/*`, `project-storage/*` (SQLite `schema.baseline.sql`), `project-workspace-navigation/*`, `window-project-directory/*`, `remote-projects/*` |
| Desktop, web and remote transports | `packages/desktop/*` (electron main/host/renderer + e2e), `packages/web/*`, `packages/web-share/*` (conversation-share), `packages/server/*` (incl. `build-remote.ts`), `packages/zcode-server-cli/*`, `packages/android/*`, `packages/services/src/remote-sync/*`, `source-server-workspace/*`, `packages/services/src/conversation-share/*` |
| Preferences, theme, accessibility, packaging, updates | `packages/services/src/setting/*` (settingService, observable), `packages/services/src/output-style/*`, `packages/services/src/client-config/*`, `packages/services/src/startup-storage/*`, `packages/services/src/window-controller/*`, `packages/services/src/runtime-tools/*`, root `Dockerfile.desktop-e2e`, `mise.toml`, `.release-it.mjs`, `scripts/build-zcode.mjs`, `build:sea` toolchain |
| Telemetry, diagnostics, error handling, test harnesses | `packages/services/src/telemetry/*`, `conversation-telemetry/*`, `memoryDiagnostics.ts`, `packages/services/src/feedback/*`, `packages/services/src/logger/*`, root vitest config + `scripts/test/*` governance suites, `packages/e2e-report/*`, `packages/desktop` e2e suites |

## Handoff path-claim verification (FINAL-TL-HANDOFF-WEEK-1.md §6A/§6B)

| Handoff claim | Result at pin |
|---|---|
| `packages/ui/src/NewTaskButtonGroup.tsx` | EXISTS — verified |
| `packages/ui/src/v4/composer/V4ComposerToolbar.tsx` | EXISTS — verified |
| `packages/contracts/src/plugins` | DOES NOT EXIST in v3.18.0 — plugin contracts live at `packages/plugin-api/src/*` and `packages/services/src/plugins/*`; use those in W1 packages |
| `adapters/plugins`, `services/plugins` | `services/plugins` exists as above; `packages/adapters/*` does not exist — plugin adapters live under `packages/services/src/plugins/*`, `plugin-sync/*`, `plugin-ui-bridge/*`, `packages/services/src/extensions/*` |
| "ToolSearch" literal | Not present by that name; deferred tool exposure surfaces via session tool-plan code (see table above) — reconcile during Week 1 |

## Upstream states relevant to preservation planning

1. `packages/zcode-cua` is a fail-closed placeholder in v3.18.0 — MOS must not build against CUA runtime surfaces that report unavailable; treat CUA-dependent routes as blocked/unknown by default.
2. The upstream snapshot has no `.github/` CI; MOS must define its own CI (build + preservation matrix) in Week 1 rather than assume upstream workflows.
3. `architecture:check -- --changed` flags 7 `packages/zcode-cua/*.js` root files as unmanaged — latent upstream module-registry gap that surfaces on the first import PR (everything is "new"); decide adopt-vs-upstream-fix via ACR before W1-B/W1-C.
4. `pnpm fmt:check` fails on 1558 files at the pristine pin (1546 inherited + 12 MOS bootstrap docs) and `fmt:check` is not part of upstream's `verify:pre-push` gate; any formatting adoption for MOS docs is an ACR decision, not an import-PR change.
5. `scripts/bootstrap.mjs` calls `git submodule update` for `apps/zcode-cli`, but the snapshot tree carries `apps/zcode-cli` as regular files (no `.gitmodules`/gitlinks) — the call is a no-op at the pin.
6. Upstream itself contains a marketing-adjacent module (`packages/services/src/marketing-touch/*` — marketingAssetRegistry, marketingTouchService). Week 1 must reconcile MOS domain authorities against it rather than duplicating it.

## Initial preservation test matrix (to be executed when adequate hardware/CI exists)

| Journey (contract §5) | Upstream machinery exercised | Where it runs |
|---|---|---|
| Start ordinary New Task | NewTaskButtonGroup + session/zcodeTaskService | desktop/web E2E + unit |
| MOS-assisted New Task (sidecar additive) | task-facts + session contract tests | new MOS tests (W1-C) |
| Choose model/provider | model-option-map + model-provider services | unit + provider regression CLI |
| Continue old session | session/tasksDatabase migrations + zcode-session | unit (existing suites cover) |
| Install/manage plugin | pluginsService + plugin-sync + plugin-api manifest | unit + desktop e2e |
| Use MCP/Skill/Command/Hook | mcp-sync, skills, commands, hooks services | unit + desktop e2e (plugins-verified container suite exists upstream) |
| Approve/reject tool | credential/permissions + automationToolPolicy | unit + e2e |
| Run workflow/subagent | subagents + zcode-agent runtime | unit + conversation-session e2e suites |
| Browser/files/terminal/Git | zcode-cua placeholder (fails closed), file/terminal/git services | unit; CUA journeys blocked by design at v3.18.0 |
| Web/desktop/remote clients | packages/web build, desktop bundle, server remote build | build matrix on adequate hardware (see baseline deviations) |
