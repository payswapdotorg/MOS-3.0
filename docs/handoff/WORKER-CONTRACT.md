# MOS 3.0 worker contract

This document governs all delegated agents and contributors.

## Start condition

Do not edit until:
- TL has completed W1-A source takeover or explicitly issued a bounded pre-takeover research task;
- current MOS-3.0 main and assigned branch SHA are recorded;
- the assigned package/paths are present in the imported ZCode source tree;
- you have read AGENTS.md, architecture-v3.0.md, decision-lock-v3.0.md, preservation-contract.md, core-contracts-v3.0.yaml and your work package.

## Ownership

Each worker receives one work package and one exclusive path set. A worker may not expand into another package to help without TL reassignment. The TL alone owns central architecture, core-contract approval, module registry, root composition, main, upstream import and final acceptance.

## Required investigation quality

- Read source code and tests, not only documentation or capability maps.
- Identify the real public API/type, implementation, callers, persistence, permissions, tests and CI.
- Record exact source files and symbols. Verify APIs against the current pinned source.
- For external integrations, use official docs and live sandbox/test-account evidence. Distinguish official source docs from third-party indexes and community posts.
- For an existing ZCode capability, extend it rather than making a parallel implementation.
- If implementation details conflict with this repository, stop and report the conflict to TL.

## No-go actions

- Do not edit New Task controls, replace composer, hide original functionality or restructure the shell.
- Do not change shared contracts, module registry, architecture policy or decision lock.
- Do not add an alternate tool/model/permission/workflow/plugin/credential authority.
- Do not introduce provider calls in domain code.
- Do not claim production connectivity from mocks.
- Do not commit secrets, account tokens, raw customer data or identifying test-account data.
- Do not force push, rebase shared branches or merge your own PR unless explicitly asked.
- Do not make a schema breaking change without ACR.

## Report format

Your handoff must include:
1. Work package ID and branch/commit SHA.
2. Source baseline SHA and actual files/symbols touched.
3. Design and dependency direction.
4. Exact test commands and complete pass/fail/skipped counts.
5. Real runtime/provider evidence, redacted and reproducible.
6. Browser/desktop journey evidence when UI is affected.
7. Permission and negative-path tests.
8. Changed/deleted public APIs, controls, routes, permissions and data.
9. Known limitations, provider eligibility/app review, cost/quota and blockers.
10. Rollback/feature flag, follow-up issues and explicit status from the AGENTS.md vocabulary.

A narrative claim without matching source and reproducible evidence is not acceptance.
