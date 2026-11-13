# Week 2 — discovery and orchestration (backlog)

Stage per spec/architecture/architecture-v3.0.md §12: "Week 2 discovery and orchestration".

Modules in scope (spec/architecture/module-registry-v3.0.yaml, stage week-2):

- `mos-agent-organizations` — domain roles, Agent Bodies, organizations and node offers.
- `mos-lab` — marketing research, evidence, ideas, strategy and production program discovery.

Out of scope (unchanged, remain `planned`): mos-engines, mos-content-artifacts,
mos-rights-policy, mos-production, mos-studio, mos-distribution, mos-experiments,
mos-learning, mos-commerce, mos-resource-network, and the W1 leftovers that stay
blocked/deferred (HubSpot live read — no provider account; UI composition mounting —
composition-root ownership; desktop E2E — needs display/docker).

## Stage goals

1. Node/network side of the economic model (architecture §8): register Agent Bodies,
   organizations and nodes; publish service offers that carry every §8-required disclosure;
   fail closed when a disclosure is missing or unknown.
2. Lab side of the loop (architecture §2, decision lock #18): record research notes and
   insights from Evidence, propose hypotheses and route/program candidates, and never
   own experiment outcomes.
3. Keep provider integration evidence-based: Week 1's Composio live-read verification
   (this branch) closes the two open W1 ledger items through a real provider account and a
   real provider read; HubSpot remains blocked.

## Locked decisions that bind this stage

- Decision lock #9: no engine imports from Lab — Lab proposes, never invokes engines.
- Decision lock #18: Lab simulation is not an experiment; hypotheses carry no outcome claims.
- Node offer statement requirements (architecture §8) are a fail-closed publish gate, not a
  documentation suggestion.
- Core contract evolution is additive only; new objects ship with schemas + invariants +
  tests in the same change (contract_evolution convention).

## Exit criteria

- Both packages implemented additive-only, zero core ZCode files touched, module registry
  and architecture-policy registrations match the code.
- Contract tests green per package; new contract schemas covered in mos-contracts.
- Architecture gates (test:architecture, architecture:check --changed, typecheck, lint,
  docs/db checks, engineering suite) green at the pre-push gate.
- Publication: branch `w2/discovery-orchestration` pushed, PR opened with evidence,
  ledger updated with commit SHAs and observed times.
