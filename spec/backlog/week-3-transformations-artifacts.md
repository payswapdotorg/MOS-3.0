# Week 3 — transformations and artifact lineage (backlog)

Stage per spec/architecture/architecture-v3.0.md §12: "Week 3 transformations, Studio and
artifact lineage".

Modules in scope (spec/architecture/module-registry-v3.0.yaml, stage week-3):

- `mos-content-artifacts` — content assets, immutable versions, provenance, lineage.
- `mos-rights-policy` — rights, consent, source licensing, platform policy, review decisions.
- `mos-engines` — engine catalog, benchmark/license policy, sandbox invocation descriptors.
- `mos-production` — transform definitions, production graphs, durable production business
  state.
- `mos-distribution` — provider publish/update/delete intents, previews, approval bindings,
  execution records.
- `mos-experiments` — actual-world experiment design, assignment, measurement evidence and
  outcome (the Experiment authority of decision lock #18).
- `mos-learning` — calibration and recommendations from verified evidence, delayed-mode
  safeguards.
- `mos-studio` — human-facing production coordination (this stage's UI-bearing module).

## Stage scope decisions (explicit)

- **mos-studio is deferred within the stage**: its human-facing surface depends on the
  composition-root ownership decision that has blocked in-app UI mounting since Week 1
  (see IMPLEMENTATION-STATE blockers). The domain seam it needs (production graph +
  artifact + rights reads) is delivered by mos-production/mos-content-artifacts this week;
  studio stays `planned` with a note instead of scaffolding an unmountable shell.
- **Execution stays with ZCode** (decision lock #5): mos-production records durable job
  state and references external ZCode execution ids; it never spawns a second executor.
- **Engine invocation is contract-level only** (decision lock #9): mos-engines owns the
  registry/catalog + sandbox policy descriptors; actual engine execution adapters are a
  composition-root concern and remain unmounted.

## Exit criteria

- All 7 in-scope packages implemented additive-only, zero core ZCode files touched,
  registry + architecture-policy registrations match the code.
- Contract tests green per package; new contract schemas covered in mos-contracts.
- Architecture gates (test:architecture, architecture:check --changed, typecheck, lint,
  docs/db checks, engineering suite) green at the pre-push gate.
- Publication: branch `w3/transformations-artifacts` pushed, PR opened with evidence,
  ledger updated with commit SHAs and observed times; studio deferral recorded visibly.
