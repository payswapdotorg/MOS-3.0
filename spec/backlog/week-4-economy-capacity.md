# Week 4 — model/engine economy and network capacity (backlog)

Stage per spec/architecture/architecture-v3.0.md §12: "Week 4 model/engine economy and network capacity"; economic model per §8 (service offers, Human Production Task Packages, do-not-assign-people-by-default).

Modules in scope (spec/architecture/module-registry-v3.0.yaml, stage week-4):

- `mos-resource-network` — human/agent/tool/engine/team node discovery, service offers,
  gigs (Human Production Task Packages) and matching.
- `mos-commerce` — offer/product, pricing and customer/market intelligence domain
  capabilities.

Out of scope (unchanged, stay as recorded): HubSpot live read (blocked at the account
owner's Google 2-Step Verification), Desktop visual mount + desktop E2E and cross-client
visual regression (no docker/display), mos-studio production-surface reads (later studio
milestone), marketplace copy-style plugin packaging (vendoring the external native module
chain), environment-sensitive miseToolchainEnv failure (pre-existing baseline).

## Scope decisions (single TL workstream)

Per decision lock #21 (max three parallel workstreams; TL owns central integration and
architecture), this stage runs as a **single TL workstream** (the composition-root
milestone precedent) — no worker packages are issued; the two modules share the contract
extension and gate wiring and would otherwise collide on shared-contract ownership.

- **Service offers are NOT re-modeled.** Architecture §8 paragraph 2 already landed in
  Week 2 (`NodeOffer` + fail-closed publish gate, owned by mos-agent-organizations).
  mos-resource-network consumes offers only through an injected `OfferLookup` port (the
  mos-lab precedent) and never re-registers them.
- **Code-level dependencies stay `@mos/contracts`-only.** Registry-level dependencies
  (mos-agent-organizations, mos-capabilities, mos-integrations) reconcile through
  structural lookup ports wired by the composition root (the mos-lab `OfferLookup` and
  mos-learning `ExperimentLookup` precedents). No new ACR is required; no provider SDK,
  database, ORM, scheduler or engine import is introduced (decision locks #2/#5/#8/#9).
- **Gig = the §8 Human Production Task Package, verbatim field-for-field**: objective,
  source references, script/brief, capture or execution instructions, expected output,
  consent/rights (rights-record refs), evaluator, deadline, budget/reward, expected value
  of waiting, alternative routes. Draft gigs may carry nulls; assignment requires the
  full package (the W2 offer-gate pattern applied to assignment instead of publication).
- **Do-not-assign-people-by-default is a contract invariant (§23), not advice.** A gig is
  assigned to a human node only with a route comparison that compared agent/engine and
  no-op/reuse alternatives, none of which is adequate, with evidence; adequacy `unknown`
  never counts as adequate (decision locks #14/#17 projections).
- **Pricing history is append-only (§24).** Price amounts/models/windows are immutable
  after creation; supersession appends a new record (architecture §9: financial/audit
  meaning requires append-only).
- **Customer/market intelligence is evidence-gated (§25)** and stores opaque subject
  refs only — no customer PII in records (AGENTS.md §4).
- **Discovery surfaces, never hides (§26)**: excluded/inactive/draft/withdrawn
  candidates are returned with named reasons (the mos-engines deprecated-engines-surfaced
  idiom), never silently filtered.

## Contract additions (TL-owned, additive-only, contract_evolution convention)

New `# ===== Week 4 additive objects =====` block in spec/contracts/core-contracts-v3.0.yaml,
zod projection in a single new file `packages/mos-contracts/src/contract/economy.ts`:

- Objects: `NetworkNode`, `Gig`, `ExecutionOption`, `RouteComparison` (resource-network
  authority), `CommerceProduct`, `PriceRecord`, `MarketIntelligenceRecord` (commerce
  authority).
- Enums (all fail-closed with trailing `unknown` where status-like): `network_node_status`,
  `gig_status`, `execution_option_kind`, `execution_option_adequacy`,
  `execution_recommendation`, `product_status`, `pricing_model`, `price_status`.
- Invariants §23–§26 (runtime guards appended to
  packages/mos-contracts/src/domain/invariants.ts):
  §23 gig human-assignment justification, §24 price-record immutability (append-only
  pricing history), §25 market-intelligence evidence gate, §26 discovery honest surfacing.

## Exit criteria

- Both packages implemented additive-only, zero core ZCode files touched
  (`git diff --name-only origin/main` = gate wiring + docs only), module registry and
  architecture-policy registrations match the code.
- Contract tests green per package (per-package suites) and new contract schemas covered
  in mos-contracts (week4 test file, registered in the engineering list — including the
  W3 contracts test file that W3's gate wiring omitted, backfilled here and flagged).
- Architecture gates (test:architecture, architecture:check --changed, typecheck, lint,
  docs/db checks, engineering suite) green at the pre-push gate.
- Publication: branch `w4/economy-capacity` pushed, PR opened with evidence, ledger
  updated with commit SHAs and observed times.
