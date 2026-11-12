# Import ZCode v3.18.0 into MOS-3.0

## Summary

Import the complete ZCode v3.18.0 source tree into MOS-3.0 while preserving the MOS architecture bootstrap commit and upstream Git history. This PR must not add MOS feature code or alter the ZCode application behavior.

## Required lineage

- MOS base: e3c0fa0e2f477988441d283428b259c6409180f6
- MOS current main SHA at import time: record the exact live HEAD here before opening the PR.
- ZCode pin: b95ebaffeab641907b38652f45c1502bd762972d
- ZCode Source-Commit: cc1f87e46ee496845be243b475bb116c35d952f6

## Git topology

- [ ] Import commit has the MOS current main as one parent.
- [ ] Import commit has the exact ZCode v3.18.0 pin as the other parent.
- [ ] MOS bootstrap and docs commits remain ancestors.
- [ ] Upstream remote/tracking ref are recorded.
- [ ] No force push, squash or rebase has erased upstream lineage.

## Conflict and source inventory

List all conflicts and resolutions. Confirm all ZCode source, test, CI, license, notice and packaging files are retained. Confirm the MOS README, AGENTS.md, spec and docs are retained. Attach the source inventory and hash manifest.

## Baseline

Record package manager/runtime versions and exact install, lint, typecheck, build, unit, integration and E2E commands. Include full pass/fail/skipped counts and every known failure. A skipped command is not a pass.

## Preservation

Attach the initial feature inventory and test matrix for New Task, Composer, sessions, model selection, plugin/MCP, permissions, agents, workflow, automations, browser, file/terminal/Git, web/desktop/remote clients and packaging.

## Rollback

Explain how the import branch/PR can be reverted without force-updating main or deleting the original MOS bootstrap commits.
