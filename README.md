# MOS 3.0 — Marketing Operating Harness

**Status:** Architecture bootstrap  
**Repository:** `payswapdotorg/MOS-3.0`  
**Application substrate:** `zai-org/ZCode`  
**Canonical upstream baseline at bootstrap:** `b95ebaffeab641907b38652f45c1502bd762972d` (ZCode v3.18.0, 2026-11-11)

MOS 3.0 is a marketing operating harness built by extending ZCode itself. It is not a replacement chat application, a separate Next.js product, or a new application shell.

## Product thesis

Preserve ZCode as the recognizable, fully functional general-purpose application and execution substrate. Add MOS domain intelligence and operating capabilities so users can connect professional platforms once, express objectives through the existing ZCode New Task experience, discover available and conditional routes, orchestrate tools/engines/agents/people, execute with approval, and learn from real outcomes.

**ZCode stays the application and generic execution substrate. MOS adds the marketing operating system.**

## Non-negotiable preservation contract

- Retain the original ZCode New Task journey and every original New Task control.
- Retain the original Composer, model selection, conversations, projects/workspaces, files, terminal, browser, tools, permissions, agents, skills, MCP, plugins, marketplace, automations, background work, remote transport, desktop/web clients, settings, theming and packaging.
- Do not replace the existing application shell, create a replacement Next.js application, or redesign the theme/layout as a prerequisite for MOS.
- MOS surfaces are additive, contextual, feature-gated and progressively disclosed.
- Extend existing authorities and runtimes through narrow adapters. Do not create a second model router, tool executor, permission authority, session authority, workflow engine, scheduler, or generic plugin marketplace.
- A change to a shared ZCode component must prove existing behavior remains intact.
- MOS domain code must not depend on concrete provider SDKs or concrete engines.

The detailed preservation rules and acceptance tests are in `spec/architecture/preservation-contract.md`.

## Product operating loop

Mission / objective → Marketing Lab → evidence-backed ideas and strategies → capability and route discovery → production program → Studio / engines / agents / human contributors → artifacts and lineage → rights / policy / quality gates → approved distribution or other real-world experiment → measurement → learning and calibration → next run.

Simulation is not real-world evidence. Provider-declared support is not proof of live availability. Unknown states remain unknown.

## Architecture

MOS owns its domain authorities (missions, Lab, capabilities, engines, production, content/artifacts, rights/policy, integrations, distribution, experiments/evidence/learning, agent organizations and network resources). ZCode remains the host, generic runtime and application.

The primary integration model is:
1. Connect domain tools through existing ZCode plugins/MCP/OAuth and provider infrastructure.
2. Map the provider's actual operations to versioned MOS capability contracts.
3. Resolve account-specific capability instances, authorization, status, constraints, cost and latency.
4. Discover relevant tools lazily through ZCode's existing tool discovery / deferred exposure.
5. Plan and compare existing, conditional and opportunity-constrained routes.
6. Compile approved MOS production programs onto ZCode's existing execution substrate and MOS durable-job/production authorities.
7. Record provenance, audit facts and actual results.

See `spec/architecture/architecture-v3.0.md`, `spec/architecture/decision-lock-v3.0.md` and `spec/architecture/module-registry-v3.0.yaml`.

## Canonical source of truth

This repository is the only implementation and architecture authority for MOS 3.0. Read in this order:

1. `AGENTS.md`
2. `spec/architecture/architecture-v3.0.md`
3. `spec/architecture/decision-lock-v3.0.md`
4. `spec/architecture/preservation-contract.md`
5. `spec/architecture/source-baselines.yaml`
6. `spec/architecture/module-registry-v3.0.yaml`
7. `spec/architecture/architecture-policy-v3.0.yaml`
8. `spec/contracts/core-contracts-v3.0.yaml`
9. `spec/integrations/provider-integration-strategy-v3.0.md`
10. `spec/backlog/week-1-integration.md`
11. `spec/backlog/week-1-work-packages.yaml`
12. `docs/handoff/FINAL-TL-HANDOFF-WEEK-1.md`
13. `docs/handoff/WORKER-CONTRACT.md`
14. The exact assigned work package and current implementation-state record.

Architecture changes require a repository Architecture Change Record. Chat, memory, issue descriptions, PR text, worker reports and screenshots are not architecture authority.

## Four-week delivery sequence

- **Week 1 — Integration:** source-verified fork baseline, additive ZCode extension points, account/credential flow, provider adapters, capability declarations and real connected-tool proof.
- **Week 2 — Orchestration:** intent interpretation, capability discovery, route planning, MOS agent bodies/organizations, route evaluation and reusable orchestration extensions.
- **Week 3 — Transformation:** capabilities/engines, transforms, production graphs, artifact lineage, Studio and human/AI production.
- **Week 4 — Fabric:** economical provider selection through the existing model runtime, free-tier providers where genuinely available, local model serving, resource discovery and local/remote engine execution.

The weeks are delivery targets, not assumptions about third-party app-review timelines or API availability.

## First implementation stage

The Tech Lead must begin with Week 1 as specified in `docs/handoff/FINAL-TL-HANDOFF-WEEK-1.md`. Do not begin by redesigning the UI or mass-producing plugins. First verify the current upstream/fork baseline, preserve the ZCode application, freeze the provider/capability boundaries, then ship one end-to-end real connector journey through the existing New Task experience.

## Completion standard

A claim is complete only when source, tests, actual runtime/provider evidence and applicable UI/browser/deployment evidence agree. Mocks and in-memory doubles may validate contracts but never prove production provider connectivity. Report blockers, provider restrictions and incomplete approval paths explicitly.
