# FINAL TL HANDOFF — MOS 3.0, Week 1 integration foundation

**Repository:** https://github.com/payswapdotorg/MOS-3.0  
**Architecture authority:** this repository only  
**Status:** Authorized to begin Week 1 implementation after the source-takeover gate below  
**Product constraint:** extend the real ZCode application; preserve all original functions and New Task controls.

## 0. Mission

You are the Tech Lead for the first implementation stage of MOS 3.0. Build the marketing operating harness inside the actual ZCode codebase.

MOS helps users:
- express a business/marketing objective naturally through the familiar ZCode New Task experience;
- connect marketing/customer/content/measurement tools through official authorization;
- discover what their connected accounts can actually do;
- compare viable and conditional paths to an outcome;
- coordinate existing tools/agents and, in later stages, engines and human contributors;
- execute under existing permission controls and preserve evidence for learning.

Do not build a separate chat app. Do not redesign or replace ZCode. Do not remove any existing feature. The user should still recognize and use ZCode normally when MOS is disabled or unavailable.

## 1. Authoritative reading order

Read these files in the current MOS-3.0 main branch:
1. AGENTS.md
2. README.md
3. spec/architecture/architecture-v3.0.md
4. spec/architecture/decision-lock-v3.0.md
5. spec/architecture/preservation-contract.md
6. spec/architecture/source-baselines.yaml
7. spec/architecture/module-registry-v3.0.yaml
8. spec/architecture/architecture-policy-v3.0.yaml
9. spec/contracts/core-contracts-v3.0.yaml
10. spec/integrations/provider-integration-strategy-v3.0.md
11. spec/backlog/week-1-integration.md
12. spec/backlog/week-1-work-packages.yaml
13. docs/handoff/WORKER-CONTRACT.md
14. docs/handoff/IMPLEMENTATION-STATE.md

The repo supersedes this handoff if it is later changed through an approved ACR. Never use chat as authority for an architecture change.

## 2. Source-takeover gate — do this first

Bootstrap commit currently on MOS-3.0 main: e3c0fa0e2f477988441d283428b259c6409180f6. It contains canonical architecture, but does not yet contain the ZCode application source tree.

Pinned upstream observed at bootstrap:
- https://github.com/zai-org/ZCode
- v3.18.0
- b95ebaffeab641907b38652f45c1502bd762972d
- Source-Commit cc1f87e46ee496845be243b475bb116c35d952f6

Before writing MOS feature code:
1. Read the current MOS-3.0 main tree and verify the bootstrap commit is still present. Check for work on remote; do not assume the local clone is clean or at expected HEAD.
2. Re-query upstream main and the exact pinned commit. Record whether upstream advanced after bootstrap.
3. Import/fork the entire ZCode source tree from the pinned commit into MOS-3.0 using a reviewed Git history-preserving strategy. Preserve this architecture bootstrap commit and avoid force-push or destructive history rewrite. Track the upstream remote/ref explicitly.
4. If GitHub's ordinary fork relationship cannot be created because the target repo already exists, use a carefully reviewed import approach that preserves both MOS bootstrap and upstream lineage. Do not silently delete the README/architecture history, reset main without lease, or replace MOS-3.0 by a separate repository.
5. Create a source inventory mapping the application areas listed in preservation-contract.md to real code paths, tests and CI.
6. Run the upstream baseline: package manager setup/install, lint, typecheck, build, focused unit/integration tests and existing E2E smoke checks. Record exact command lines, environment/tool versions, counts and failures. Do not claim a passing baseline if commands were skipped.
7. Update source-baselines.yaml and IMPLEMENTATION-STATE.md with the exact imported SHA/tree, merge/import commit, remotes, baseline and any deviations.
8. TL signs off this gate before workers begin edits.

A practical Git approach may require a temporary worktree or branch to fetch the upstream commit, bring its tree/history into the existing repository, and merge it with the MOS bootstrap lineage. The exact commands depend on the resulting Git state; inspect first. Never copy only selected app directories and call it a fork. Never overwrite main by force.

## 3. Product and architecture boundaries

ZCode owns:
- app shell and clients;
- New Task, Composer, sessions and project/workspaces;
- model/provider selection and execution;
- AgentRuntime, subagents and generic tool execution;
- permissions and approvals;
- plugins, MCP, OAuth, Skills, Commands, Hooks and extension host;
- Dynamic Workflow, background work, scheduler and channels;
- browser/CUA, files, terminal, Git and remote transports.

MOS owns marketing domain authorities:
- missions;
- Lab research and evidence;
- capabilities and account-specific instances;
- routes;
- marketing agent roles/organizations and later network nodes;
- engines/transforms/production graphs;
- content artifacts and lineage;
- rights/policy;
- integrations and distribution records;
- actual experiments, measurements and learning.

Reuse ZCode services through narrow adapters. Do not create a second authority for model routing, tools, permissions, workflow, scheduler, sessions, plugins or marketplace.

## 4. Week 1 implementation objective

Deliver one narrow but real vertical slice:

A user opens the normal ZCode New Task experience and enters a marketing/customer-growth objective. The existing task path remains intact. MOS optionally interprets that prompt, creates a Mission sidecar linked to the existing ZCode session/task, resolves capabilities for an officially authorized provider connection, determines one route that can run now and another that is conditional or blocked, and performs a real provider read through the existing ZCode MCP/tool/runtime/permission infrastructure. Evidence is stored with source, observed time and tenant. A missing scope or unauthorized write is denied.

Preferred first connector is HubSpot official remote MCP/CRM if access can be provisioned. It is a candidate, not a hardcoded dependency. The TL may choose a different connector if it is more feasible and provides a meaningful proof. Do not write a custom provider auth system if ZCode already supports the needed OAuth/MCP path.

## 5. Team and ownership

Maximum three parallel workstreams. TL is the sole owner of source takeover, central architecture/contracts, shared composition and final acceptance.

After source takeover, allocate:
- Worker B — provider descriptor, auth mapping, account-scoped capability resolver and one live read adapter. Own only the W1-B path set in week-1-work-packages.yaml.
- Worker C — additive Mission sidecar, route candidate evaluation and minimal contextual New Task contribution. Own only the W1-C path set.
- The third workstream may perform independent preservation test inventory/automation or review only after TL assigns a non-overlapping package. Do not exceed three concurrent workstreams or create shared-file contention.

Do not ask workers to independently design the architecture. Provide their exact package, contract version, base SHA, allowed paths, forbidden paths and acceptance gates. They must report with WORKER-CONTRACT.md.

## 6. Implementation guidance

### A. ZCode fork and preservation

- Use the current repo package manager, conventions, module boundaries and test infrastructure.
- Build a preservation test matrix before edits.
- Find the real source paths for New Task and Composer from the imported pinned source. Earlier source audit identified packages/ui/src/NewTaskButtonGroup.tsx and packages/ui/src/v4/composer/V4ComposerToolbar.tsx as important locations; verify paths and callers against the imported tree before editing.
- Prefer not to edit those core controls in the first slice. If an extension slot or post-submit intake boundary is sufficient, use it.
- Existing ZCode session remains the source of truth for messages and generic task state. Mission references session/task IDs; no duplicate conversation store.
- If MOS parsing or sidecar persistence fails, the normal ZCode task must still be created and function normally.
- Use feature flags for MOS additions. A user may disable MOS and still use the app without regression.

### B. Plugin and provider model

- Read actual plugin/MCP contracts in the imported source, including packages/contracts/src/plugins, adapters/plugins, services/plugins, MCP sync, plugin-ui bridge, extension slots and ToolSearch.
- Keep ZCode plugin manifest schema unchanged.
- Use a separately versioned MOS capability descriptor adjacent to the provider connector.
- A plugin may expose multiple capabilities; a capability may have multiple provider implementations.
- Capability declarations are not proof the connected user's account has permission.
- Resolve support, auth scopes, account type, app-review state, quota and provider availability into an account-specific capability instance.
- Prefer official API or official remote MCP. Browser/CUA are fallback execution routes and never credential scraping methods.
- Secret material stays in ZCode credential storage. MOS saves only an opaque credential reference and safe scope/status facts.
- Map only exact tools/operations discovered in the real provider adapter. No pretend tool names or capabilities.

### C. Tool economy and routing

- Reuse ZCode's deferred ToolSearch/exposure mechanism for large connector catalogs.
- Route classes are existing, conditional, opportunity_constrained, blocked and unknown.
- Do not build the full general planner in Week 1; implement the minimum resolver to demonstrate honest states and prerequisites.
- Each proposed action discloses provider, account, capability, input, side effect, cost/quota where known, required approval and fallback.
- The user retains model/provider choice; there is no silent model switch.

### D. Provider evidence and live testing

- Read official docs freshly before implementing the connector; record source URL and observed date.
- Use a sandbox/test organization where possible.
- Prove real read path with an authorized account.
- Test expired/revoked token, insufficient scope, wrong account/tenant, provider outage, rate limit and malformed response.
- Never include raw CRM records or personal data in committed fixtures. Use synthetic/redacted test records.
- A live write is optional only if safe. It still requires explicit preview and normal ZCode permission approval. No production write based on implicit task intent.

## 7. Acceptance test journeys

**Journey 1 — normal ZCode**
1. Start app.
2. Start New Task with MOS disabled/unconnected.
3. Use model selection, existing Composer controls and attachments.
4. Submit and continue/resume session.
5. Confirm original behavior and no MOS setup requirement.

**Journey 2 — MOS-assisted intake**
1. Start the same New Task.
2. Enter a marketing objective, e.g. "Find a way to increase qualified inbound leads for our service business over the next 90 days."
3. Keep all original controls visible and usable.
4. MOS creates a Mission sidecar only after standard task creation succeeds, linked to the same ZCode session/task.
5. User can inspect/edit the interpreted goal; uncertainty remains explicit.
6. Disable MOS or simulate parser failure and verify standard task still works.

**Journey 3 — account capability**
1. Authorize the test provider through its official login/MCP OAuth flow.
2. Resolve account identity and scopes without logging secrets.
3. Execute one actual read tool.
4. Record safe Evidence with provider source, observed time and account/tenant reference.
5. Revoke token/remove scope and confirm the capability instance is no longer available.

**Journey 4 — routes and permissions**
1. Given a connected read capability, produce an existing route.
2. Given a missing scope/app review/provider connection, produce a conditional route with exact prerequisite.
3. For unsupported or ambiguous operation, preserve unsupported/unknown and fail closed.
4. Attempt a write without approval and prove existing ZCode permissions block it.
5. If safe sandbox write is enabled, preview exact target/artifact/cost/operation; approve with existing ZCode UI; perform once; reconcile result and idempotency.

**Journey 5 — preservation**
Re-run the baseline and regression matrix for New Task, sessions, model selection, plugins/MCP/skills, permissions, Workflow, browser, files/terminal/Git and supported clients. Include a browser/desktop test for every client whose UI or extension host changed.

## 8. Definition of Week 1 complete

All criteria in spec/backlog/week-1-integration.md must pass. In particular:
- MOS-3.0 is a complete, buildable ZCode fork with traceable lineage.
- Original app and New Task remain functional.
- One real provider read is verified from user task through adapter/tool to evidence.
- Account-specific capability and route states are honest.
- Existing permission layer is preserved and blocks unauthorized writes.
- No replacement app, shell or hidden New Task controls.
- Focused tests, full relevant regression, CI, API/runtime and UI evidence are linked.
- Implementation state and module registry reflect source-proven status.

A repository containing only architecture docs, descriptors, mocks or UI screenshots is not Week 1 complete.

## 9. Reporting cadence and PR policy

- Commit in narrow topic branches from the recorded base SHA.
- Open PRs against MOS-3.0 main; no direct main edits except TL-approved bootstrap/merge operations.
- Include exact changed files, tests, live-provider evidence, permission tests, preservation matrix, screenshots/recordings where UI changed, limitations and rollback.
- TL reviews actual source, test changes, provider requests/results and UI flows. Do not accept reports on trust.
- At each merge, update IMPLEMENTATION-STATE.md with commit and evidence. Never mark planned work as verified.

## 10. First action to take now

Perform Section 2 source takeover. Once the imported source and preservation baseline are accepted, start W1-B and W1-C in parallel using the exact paths and contract above. The repository state and work packages are the complete handoff; no further chat specification is required.
