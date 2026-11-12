# Week 1 — ZCode-preserving integration foundation

**Stage outcome:** A real user can create an ordinary ZCode task exactly as before or create a MOS-assisted task that links a marketing Mission sidecar, resolves live account-specific capabilities through an authorized connector, compares an available and a conditional route, and safely executes a permitted read through the existing ZCode tool/permission/runtime path.

This is not a full social publishing suite or a shell redesign.

## Stage 0 — source takeover (blocking prerequisite)

- Reverify MOS-3.0 main and ZCode upstream.
- Import/fork the complete ZCode v3.18.0 source at the pinned SHA while preserving this architecture commit and Git history.
- Record exact tree hashes, fork point, remote/tracking ref and any deviations.
- Run upstream install, lint, typecheck, build and test baseline using the repository's own commands.
- Inventory all preservation surfaces and identify actual extension contracts. Update source-baselines.yaml.
- Do not begin feature code before this gate is accepted by TL.

## Stage 1 — domain contract and adapter foundation

- Freeze the core contract schemas in core-contracts-v3.0.yaml.
- Create small module packages consistent with the imported repository's conventions; do not impose a new monorepo layout or framework.
- Create MOS-to-ZCode identity/session adapter using existing identity and session context.
- Add Mission sidecar linkage; ordinary ZCode tasks remain unaffected.
- Add capability descriptor schema and validation.
- Add account-scoped provider connection and capability instance resolver using existing ZCode credential and OAuth authorities.
- Add one provider adapter (preferred HubSpot official remote MCP / CRM, or TL-approved safer/closer alternative).
- Add real authenticated read operation and safe evidence capture.
- Add a second source only if the first vertical needs it to prove a useful end-to-end journey and account access exists.

## Stage 2 — route and New Task sidecar

- Interpret an existing New Task prompt as a mission candidate without changing the New Task form or controls.
- Persist a Mission and nullable ZCode session/task linkage only after standard task intake has succeeded or through a safe sidecar transaction.
- If the user chooses not to use MOS or the parser fails, the normal ZCode task path must proceed unchanged.
- Build minimal route candidates: existing, conditional and blocked/unknown as appropriate.
- Explain missing provider connection, scope, account eligibility or approval without inventing capability.
- Use deferred tool exposure to make relevant tools available when needed; never create another tool registry/router.
- Add only a small contextual UI contribution using actual extension contracts; no shell-level changes.

## Stage 3 — real proof and regression

- Complete the live provider read end-to-end, from task intent to capability instance to tool execution to evidence.
- Prove a forbidden/missing-scope action is denied by existing ZCode authorization.
- If a safe test write exists, require explicit preview/approval and reconcile the result; otherwise document the limitation.
- Re-run preservation checklist and relevant upstream regression suite.
- Validate web and desktop where the extension surface affects both. If the surface is unsupported on one client, ensure core tool/MCP behavior still works there.
- Update implementation-state with only evidence-backed status.

## Week 1 exit criteria

All are mandatory:
1. MOS-3.0 is a real, buildable ZCode code fork with exact lineage recorded.
2. Existing ZCode app and New Task functionality build and pass the pre-change preservation baseline.
3. Existing New Task creates a normal ZCode task with no MOS provider setup.
4. MOS-assisted New Task uses the original controls and creates/link a Mission sidecar without replacing conversation/session/task authority.
5. Provider connection is official and account-authorized; no secrets leak.
6. Capability descriptor maps to real provider operations; account capability instance is derived from current auth/scope/account checks.
7. At least one real provider read operation succeeds and records evidence.
8. Existing, conditional and blocked/unknown routes are distinguishable and fail closed.
9. Existing ZCode permission approval blocks unauthorized external writes.
10. The same original features continue working on affected clients; no replacement app/shell.
11. Focused tests, package tests, typecheck/lint/build and CI evidence are attached.
12. Source-based implementation state is updated and TL independently verified.

## Out of scope for Week 1

- Full Lab strategy generation or autonomous campaign running.
- Complete content generation/Studio/video editing engine stack.
- Production social publishing across every platform.
- Marketplace monetization, gigs, payouts or node reputation.
- New model router or full free-model marketplace.
- Local fine-tuning or Soup integration.
- Complete CRM, ad, analytics, SEO and social provider catalog.
- New dashboard or shell redesign.
