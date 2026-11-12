# Repository operating rules

This file is binding for human contributors, coding agents, workers and the Tech Lead.

## 1. Authority and precedence

1. The current repository HEAD is the authoritative implementation state.
2. README.md and the documents listed in README.md are the canonical product/architecture authority.
3. An approved Architecture Change Record (ACR) in spec/decisions is required to change a locked decision.
4. Work packages under spec/backlog and docs/handoff define current execution scope.
5. Source code, tests, migrations and runtime evidence establish what is implemented.
6. Issues, PR descriptions, chat, memory, worker reports, generated plans and screenshots are not independent sources of truth. They must link to the canonical repository artifacts.

When documents conflict, stop the affected implementation and ask the TL to resolve the conflict by updating the canonical document. Do not silently pick a version.

## 2. Non-negotiable product boundary

MOS 3.0 extends the actual ZCode codebase. Preserve the original ZCode application, shell, navigation, New Task, Composer, controls, model selection, sessions, projects/workspaces, files, terminal, browser, tools, permissions, agents, skills, MCP, plugins, marketplace, automations, background work, remote transport, desktop/web clients, settings, theming and packaging.

Do not introduce a replacement Next.js application, new shell, theme/layout replacement, or a new chat product. Read spec/architecture/preservation-contract.md before touching any shared UI or runtime boundary.

## 3. Baseline and repository takeover

The canonical ZCode source at bootstrap is:
- Repository: https://github.com/zai-org/ZCode
- Version: v3.18.0
- Commit: b95ebaffeab641907b38652f45c1502bd762972d
- Source-Commit recorded by upstream: cc1f87e46ee496845be243b475bb116c35d952f6

Before implementation:
- Verify upstream main and the pinned commit through GitHub; record observation time and hashes.
- Inspect actual MOS-3.0 HEAD, branch, tree, and uncommitted state.
- Establish MOS-3.0 as a code fork from the exact pinned source without losing the architecture bootstrap commit. Preserve Git history and record the fork point. The TL must use the repository's existing history and a reviewed import/synchronization procedure; do not force-push or overwrite main.
- If the GitHub fork/import operation cannot preserve the bootstrap commit, stop and propose a reviewed import strategy. Do not silently convert MOS-3.0 to a docs-only repository or make a detached clone appear authoritative.
- Track upstream as an explicit remote/ref. Upstream syncs are deliberate, reviewed, and recorded; no blind merge of upstream product changes.

## 4. Engineering constraints

- Use TypeScript strictness and existing repo conventions. Do not invent a new stack.
- Do not add a database, ORM, runtime, scheduler, workflow engine, model router, tool executor, permission authority or provider SDK layer without an ACR.
- Do not use SQLite as a substitute for the established persistence target. Inspect the actual ZCode and MOS repository data model before selecting storage; use Postgres where a new durable service is approved.
- No direct provider SDK calls from MOS Lab, Studio, mission, route-planning, experiment or other domain code. Provider I/O belongs behind Integration adapters.
- No concrete engine imports from domain packages. Engine invocation is through a versioned capability/engine contract and adapter.
- No credentials, API keys, OAuth tokens, cookies, session secrets, raw authorization headers, personal data or customer records in source, logs, artifacts, telemetry, tests, fixtures, reports or screenshots.
- Provider/account status is evidence-based. Missing credentials, app review, scopes, account type or provider approval must remain visible as a blocker.
- No mock, in-memory double, fixture or stub may be reported as proof of a real provider integration.
- Fail closed for unknown/unsupported capabilities, unapproved side effects, policy failures and invalid tenant scope.
- Do not weaken existing ZCode permissions, safety checks, tests, CI or extension trust warnings to make MOS work.
- Keep changes narrow and independently reviewable. Prefer extension/adaptor packages over cross-cutting edits.

## 5. Worker protocol

- Maximum three parallel workstreams. TL owns architecture, composition root, shared contracts, repository state, integration decisions and final verification.
- Each work package has one owner, explicit allowed paths, forbidden paths, outputs and acceptance tests.
- Workers must read this file and their work package before editing.
- Workers do not edit central architecture, module registry, shared contract lock, main composition root or one another's assigned paths unless TL explicitly reassigns ownership in the repository.
- No worker may claim a connector, provider action or user journey complete without source-linked implementation and reproducible runtime evidence.
- Each workstream reports commit SHA, changed paths, tests run with exact commands/results, runtime evidence, unresolved limitations and known regressions.
- TL independently verifies source, tests, CI, API/runtime behavior and UI journeys. Worker narrative is not acceptance evidence.

## 6. Required change workflow

1. Read the current canonical documents and assigned work package.
2. Verify the branch HEAD and worktree; record the exact baseline SHA.
3. Write/update an ADR before changing a locked architecture decision.
4. Add contract tests before or alongside implementation.
5. Implement the smallest vertical slice.
6. Run focused tests, relevant package tests, lint/typecheck/build and regression tests.
7. Prove real provider operations where applicable; distinguish mocked contract tests from live account evidence.
8. Inspect diff for deletions, bypasses, secret leakage, permission changes and out-of-scope churn.
9. Update the implementation-state record, module registry and decisions only when the code evidence justifies the status change.
10. Submit a PR with evidence and rollback notes.

## 7. Completion language

Use only:
- planned — specified, not implemented;
- scaffolded — code exists but is not functionally wired;
- contract-tested — contract behavior tested without real provider execution;
- integrated — real adapter is wired, but end-to-end user journey not yet proven;
- verified — acceptance criteria and required live evidence passed;
- blocked — dependency/permission/provider access prevents completion;
- deferred — intentionally outside this stage.

Never use "done", "production-ready", "supported", "live" or "complete" on the strength of docs, screenshots, static profiles, mocks or green unit tests alone.
