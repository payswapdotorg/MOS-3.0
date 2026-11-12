# MOS 3.0 architecture decision lock

**Status:** Locked. Change only through a reviewed Architecture Change Record under spec/decisions/.

1. **The product is a ZCode harness, not a replacement app.** The MOS-3.0 implementation must be the actual ZCode codebase extended in place.
2. **ZCode remains the generic host and execution substrate.** Do not replace session, model, permission, tool, workflow, plugin, scheduler or transport authorities.
3. **No shell reset.** Existing shell, UI architecture, navigation, New Task, Composer and all existing controls remain. Add contextual surfaces; do not hide or remove existing functionality.
4. **No parallel model router.** Model/provider invocation and user selection remain in ZCode. MOS may provide task-specific advice, but no silent rerouting or duplicate routing state.
5. **No parallel workflow engine.** MOS Production Graph describes marketing/business work and compiles onto ZCode's existing Dynamic Workflow / AgentRuntime / tools. MOS keeps durable domain job state, not a second generic executor.
6. **No parallel permission system.** Existing ZCode permission/approval system is authoritative. MOS supplies operation-specific context and additional domain gates.
7. **No parallel plugin marketplace.** Reuse ZCode plugin/MCP/skill/command/hook marketplace and extension host. Introduce an adjacent, separately versioned MOS capability descriptor; do not overload or break existing plugin manifest schema.
8. **No provider calls from domain modules.** All network/provider interaction goes through Integration adapters and approved credential paths.
9. **No engine imports from Lab/Studio/domain.** Engines are selected by Engine Registry and invoked through sandboxed adapters.
10. **Capability is not a plugin.** Plugin is packaging; capability is normalized ability; provider implementation is how the account performs it; capability instance is what is ready for the connected account; engine is replaceable implementation; transform is desired operation.
11. **No new shell or Next.js application.** No duplicate frontend and no new theme/layout baseline. Preserve current ZCode web/desktop/remote build surfaces.
12. **New Task must remain usable without MOS.** MOS intent interpretation is an opt-in/additive enhancement. Ordinary ZCode task creation remains complete and independently functional.
13. **No direct user credential scraping.** Use OAuth, official API authorization, approved MCP or explicit human browser action. Never store platform passwords or browser cookies.
14. **Unknown means unknown.** Declared provider capability does not imply a connected account is authorized or available. Do not coerce unknown into supported.
15. **Mocks are not integration evidence.** Doubles may prove contracts only. Live authenticated provider calls and runtime artifacts are required for verified connector status.
16. **No premature all-platform promise.** Each platform has individual API, app-review, account-type, scope, quota and policy constraints. Ship integrations only as verified capabilities.
17. **No-op/reuse is a real route.** Reposting/reusing an asset or doing nothing may be better than unnecessary generation.
18. **Lab simulation is not an experiment.** Lab proposes hypotheses and routes; Experiment authority owns actual experiment definition, evidence and outcomes.
19. **Studio is not a publisher.** Studio coordinates content production and artifacts; Distribution executes external publishing through connectors only after permission.
20. **Rights and provenance are first-class.** No artifact can be distributed without a decision for applicable rights, consent, policy and quality gates.
21. **At most three parallel workstreams.** TL owns central integration and architecture; work packages have exclusive paths.
22. **Repository is the sole source of truth.** Chat and agent memory cannot change architecture, acceptance criteria or implementation state without committed repo updates.

## Change process

An ACR includes context, current locked decision, proposed change, affected modules/contracts/UI, migration and rollback, security/privacy impact, preservation impact, tests and evidence. TL reviews it, then the canonical lock/registry is updated in the same accepted change. No implementation may rely on a pending ACR.
