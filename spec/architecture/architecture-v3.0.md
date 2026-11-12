# MOS 3.0 architecture

**Status:** Locked bootstrap architecture. Changes require an ACR.  
**System shape:** MOS domain operating system hosted by the original ZCode application and runtime.

## 1. Product definition

MOS is a Marketing Operating System delivered as a specialized operating harness inside ZCode. It helps an individual or organization turn business and marketing objectives into evidence-backed work, connect the tools and accounts they already use, discover viable routes, coordinate agents/engines/humans, execute approved actions, measure outcomes and improve the next run.

MOS is not a new chat app. It is not a separate marketing dashboard that replaces ZCode. It is not an application shell rewrite.

The first product experience must begin from the existing ZCode New Task / Composer journey. MOS interprets and enriches the task as a domain sidecar while the original ZCode session remains the owner of the conversation and generic task execution.

## 2. Product loop

1. Mission intake: capture the objective, target/customer, geography, audience, desired outcome, timeframe, budget, channels, constraints, permissions and success metric. Missing values remain unknown; the user is not forced to complete a long form before starting.
2. Marketing Engineering Lab: investigate evidence, customer/problem/market context, ideas, strategies, organizations, channels, tools and feasible production programs.
3. Capability discovery: determine what the connected user/org can actually do with its account scopes, tools, engines, agents, people and resource nodes.
4. Route planning: compare existing, conditional and opportunity-constrained routes by preconditions, output, quality evidence, cost, latency, risk, human time and alternatives.
5. Production: compile an approved production graph into existing ZCode workflow/subagent/runtime mechanisms and MOS durable job/business records.
6. Creation: Studio coordinates desired content transformations and tools. It is not the model router, workflow engine, publisher or rights authority.
7. Artifact and governance: preserve immutable artifact versions, lineage, sources, consent/rights, quality evaluation and policy decisions.
8. Execution: preview the exact external action, account, artifact version, destination, schedule, cost and expected effect; obtain approval from the existing permission system and any required human review.
9. Measurement: record actual events, exposures, clicks, leads, conversions, spend and other provider facts with source/time/provenance.
10. Learning: evaluate results with causal/experiment safeguards, update calibration and recommend the next action.

Simulation output is a hypothesis, not an observed result. A successful tool invocation is not proof of a business outcome.

## 3. The host/substrate boundary

### ZCode remains authoritative for

- Application shell, navigation, layout system, desktop/web/remote clients and packaging.
- Existing New Task, Composer, conversation/session and project/workspace behavior.
- Model/provider selection, model invocation and provider credential lifecycle.
- Agent runtime, subagents, tool executor, tool search/deferred exposure and generic agent execution.
- Permissions, confirmations, approvals and security policy enforcement.
- Plugins, MCP transports, OAuth, Skills, Commands, Hooks, extension host and UI plugin infrastructure.
- Dynamic Workflow execution, generic background execution, scheduling, bots/channels and remote collaboration.
- Files, terminal, Git, browser, computer-use automation, generic telemetry and existing persistence abstractions.

These are reused; MOS does not fork their authority.

### MOS owns

- Tenant/organization/brand workspace semantics as a marketing domain, with a clean mapping to ZCode identity/workspace.
- Missions and objective/constraint models.
- Marketing Lab research briefs, evidence collections, idea/strategy evaluations and experiment proposals.
- Capability taxonomy, provider capability bindings and account-specific capability instances.
- Route planning, route comparison and conditional dependency resolution.
- Marketing-specific Agent Bodies, roles, Organizations and node/service offers.
- Engine registry, capability-to-engine matching and sandbox policy for media/content engines.
- Transform definitions and production graphs/programs.
- Content assets, immutable artifact versions, lineage and provenance.
- Rights, consent, policy and marketing-specific quality gates.
- Durable MOS job/business state linked to, but not replacing, ZCode execution IDs.
- Distribution intent, provider-specific action planning, approvals and execution evidence.
- Experiment definitions, measurement facts, learning and calibration.

## 4. Architecture layers

A. ZCode host: the existing application and generic execution substrate.

B. MOS domain contracts: versioned, provider-neutral schemas for mission, capability, route, production, artifact, rights, experiment and learning.

C. MOS authorities: separate bounded modules own their own durable business records and invariants. No duplicate authorities.

D. Integration adapters: connect provider APIs or remote MCP services to the versioned MOS capability contracts. They translate provider-specific shapes, auth requirements, scopes, rate limits, side effects and errors.

E. Execution adapters: adapt approved MOS production jobs and engine calls onto ZCode Workflow, AgentRuntime, tools, permission and job infrastructure.

F. Additive user surfaces: extension slots, contextual side panes, composer additions and existing plugin UI facilities. They must be feature-gated and must not replace the shell or existing controls.

## 5. Extension and interaction model

- Preserve original New Task behavior, prompt field, attachment support, mode/model/reasoning controls, plan controls, submit behavior and all other controls present in the current pinned ZCode version.
- Add an optional MOS mission-intent interpretation and mission context linked to the created ZCode session/task. If intent is ambiguous, proceed with the normal ZCode task and keep MOS context provisional.
- Use current extension points where they fit. Candidate slots already present in the source inventory include composer.status, composer.mention, sidePane.launcher, nav.primary and file.viewer; revalidate names and contracts against the pinned source before use.
- No mandatory MOS-only first-run flow. No user must connect a provider just to use ZCode normally.
- Ordinary MCP tools remain the cross-platform connector baseline. Interactive plugin panels are optional enhancements; do not make product function depend on a desktop-only panel.
- Existing provider/model selection remains user-visible and user-controlled. MOS route planning may recommend tools/engines, but it must not silently change the model or provider.

## 6. The provider-neutral execution model

The key objects are deliberately distinct:

- Plugin: an installable package that exposes tools, prompts, skills, commands, hooks or UI.
- Provider: external service/platform, such as HubSpot or YouTube.
- Provider connection: a user's authorized account/tenant with credential references and granted scopes.
- Capability: a normalized statement of what an actor/account can do, such as read CRM contacts or publish a video.
- Provider implementation: one concrete mapping of a capability to provider API/MCP operations.
- Capability instance: the result of evaluating a capability for a specific connected account, current permissions, quota, region and readiness state.
- Engine: a replaceable implementation that performs a technical capability.
- Transform: a desired operation on content/assets, e.g. clip, crop, translate, dub, caption, summarize, react, create podcast or repost/no-op.
- Production graph: an executable program combining transforms, people, engines, tools, review gates, budgets, branching, deadlines and stopping rules.
- Route: one viable or conditional plan to achieve a mission outcome using capability instances, actors, cost/time assumptions, evidence and dependencies.
- Artifact: immutable/versioned content or evidence object with lineage and rights metadata.
- Experiment: a hypothesis and measurement design for actual-world execution, not a simulated prediction.
- Node: an available human, agent, engine, tool, team or organization offering an evidenced capability.

Do not collapse these concepts into a generic plugin or agent.

## 7. Route classes

- existing: required capabilities are available, authorized and usable now.
- conditional: one or more known prerequisites are missing (OAuth, scope, app review, account type, approval, installed tool, engine, data or user decision).
- opportunity_constrained: execution requires scarce resources such as a human specialist, external agent, paid engine, local hardware or an unconnected service provider.
- blocked: route cannot proceed under current policy or hard constraints.
- unknown: evidence is insufficient to evaluate the route.

Every route must disclose prerequisites, account/tenant, capability instance, actions/side effects, estimated cost and latency, confidence, evidence, unknowns, risks, required approvals, alternatives and fallback behavior. A route can never claim available based only on a static provider profile.

## 8. Economic and human execution

The network is an execution-capacity market, not merely a social graph. A node may be a person, agent, engine, tool, company, group or team.

A service offer must state capability, inputs, output/deliverables, availability, geography/language, price/reward, deadline, SLA, rights/consent constraints, acceptance evaluator, evidence and delivery history.

A Human Production Task Package carries objective, source references, script/brief, capture or execution instructions, expected output, consent/rights, evaluator, deadline, budget/reward, expected value of waiting and alternative routes. Compare human latency and cost against agents/engines and no-op/reuse options; do not assign people by default if an adequate approved route already exists.

## 9. Storage and events

- Each MOS module owns its durable records and emits versioned domain events through the approved event/persistence boundary.
- Use the existing ZCode persistence and event mechanisms where they are fit for generic host/session facts; do not introduce another session store.
- MOS business facts must survive restarts and be tenant-scoped. In-memory registries are test-only.
- Raw secrets stay in the existing credential store. MOS stores opaque credential/connection references and safe auth metadata only.
- History and artifact lineage are append-only where provenance or financial/rights/audit meaning requires it. Corrections append new facts; they do not rewrite historical evidence.
- Retain idempotency keys for external side effects and provider event ingestion.
- Retain external provider IDs, request/correlation IDs where safe, timestamps, account refs and source metadata for audit.

## 10. Security and trust boundaries

- Use ZCode's actual authorization and permission framework. MOS may add domain-specific approval requirements but may not bypass or replace existing permission enforcement.
- Provider API is preferred. Remote MCP is acceptable when official and authorized. Browser and CUA are fallback paths, not a way to scrape credentials or evade platform policy.
- Do not collect or store users' platform passwords. Do not capture sessions/cookies from unrelated browsers. OAuth or official authorization must be used where available.
- Scope provider connections minimally. Separate read and write capabilities.
- Show the exact target account, operation, destination, artifact/version, cost, timing and irreversible effects before approval.
- Extensions/plugins can execute code. Plugin installation is not approval for external actions. Preserve existing install trust confirmations and permission prompts.
- Workflow child-process isolation is not a security sandbox. Do not execute untrusted engine/plugin code in the privileged host process.
- Engine sandbox defaults to no network and no database/provider credentials, with explicit resource quotas and controlled artifacts.

## 11. Failure and recovery

- All providers can be degraded, rate limited, revoked, unavailable or inconsistent.
- Preserve unknown rather than infer success. Reconcile ambiguous write results before retrying.
- Use idempotency where provider supports it; otherwise expose duplicate-risk and require appropriate review.
- Route fallback is explicit and may change cost, latency, audience or rights; require approval when material.
- Retrying a production job must resume from durable state and immutable inputs, not restart external side effects blindly.
- Revoked authorization invalidates affected capability instances; it must not erase the historical record that a previous action occurred.

## 12. Four-week product sequence

Week 1 integration foundation; Week 2 discovery and orchestration; Week 3 transformations, Studio and artifact lineage; Week 4 model/engine economy and network capacity. See the week-specific backlog documents. These are stages, not a guarantee of third-party API access or app review.
