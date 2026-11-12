# Import ZCode v3.18.0 into MOS-3.0

## Summary

Import the complete ZCode v3.18.0 source tree into MOS-3.0 while preserving the MOS architecture bootstrap commit and upstream Git history. This PR must not add MOS feature code or alter the ZCode application behavior. It adds: the full upstream tree, two preserved upstream doc copies under `docs/upstream/`, the SHA-256 source inventory manifest, the preservation inventory, and the takeover record in `spec/architecture/source-baselines.yaml` / `docs/handoff/IMPLEMENTATION-STATE.md`. No ZCode source file is modified or removed.

## Required lineage

- MOS base (bootstrap commit): e3c0fa0e2f477988441d283428b259c6409180f6
- MOS current main SHA at import time: 3a1f50babca07a4b045634873c08d18d81d997e6 (observed live on a fresh clone 2026-11-12T11:19Z; handoff expected SHA matched exactly)
- ZCode pin: b95ebaffeab641907b38652f45c1502bd762972d
- ZCode Source-Commit: cc1f87e46ee496845be243b475bb116c35d952f6

## Git topology

- [x] Import commit 545910f3ecf4ebc149c690c3bb7b77124e1e747e has the MOS current main (3a1f50b) as one parent.
- [x] Import commit has the exact ZCode v3.18.0 pin (b95ebaff) as the other parent (`git show --format=%P HEAD` → `3a1f50babca07a4b045634873c08d18d81d997e6 b95ebaffeab641907b38652f45c1502bd762972d`).
- [x] MOS bootstrap and docs commits remain ancestors (`git merge-base --is-ancestor e3c0fa0e HEAD` ok).
- [x] Upstream remote/tracking ref recorded: `upstream https://github.com/zai-org/ZCode.git`, tracking `upstream/main`; upstream main HEAD observed at import time == pin (upstream had not advanced); local tag `mos3-zcode-v3.18.0` marks the pin.
- [x] No force push, squash or rebase; `git merge-base HEAD b95ebaff` == b95ebaff (the pin itself).
- Upstream main SHA observed at import time: b95ebaffeab641907b38652f45c1502bd762972d (identical to pin).
- Upstream version and tree SHA: ZCode v3.18.0, tree d7ebeb994cb8f46b16761fc9c550ae3f6e039c3d.
- Import tree SHA: e18bc2ea182da7b1b9efec62a818574d57ac0663 (18,675 tracked files).

## Conflict and source inventory

Complete conflict list (add/add, exactly two, both at repo root):

| Path | Resolution | Rationale |
|---|---|---|
| README.md | Kept MOS-3.0 root README (product source-of-truth entrypoint); upstream ZCode README preserved byte-identical at `docs/upstream/README-ZCODE-v3.18.0.md` | Playbook rule: MOS root README remains the product authority; nothing of upstream lost |
| AGENTS.md | Kept MOS-3.0 root AGENTS.md (fork governance); upstream ZCode AGENTS.md preserved byte-identical at `docs/upstream/AGENTS-ZCODE-v3.18.0.md` | Same pattern; upstream agent guide retained for reference |

Completeness evidence:

- `git diff --name-only mos3-zcode-v3.18.0 HEAD` lists exactly 20 paths: the 16 non-root MOS bootstrap files (spec/, docs/handoff/), README.md and AGENTS.md (MOS content at root), and the two preserved upstream copies under docs/upstream/. Every other upstream file (18,655 of 18,657) is byte-identical to the pin — no source path was omitted, pruned or modified.
- ZCode code tree, scripts, tests (2096 test/spec files), licenses (LICENSE, NOTICE.md, THIRD-PARTY-NOTICES.md), packaging and root tooling all retained. The upstream snapshot contains no `.github/` CI (verified; recorded as an upstream state, not an omission).
- No submodules/LFS at the pin (no gitlinks, no LFS attributes).
- SHA-256 source inventory manifest: `docs/upstream/source-inventory-sha256-import-v3.18.0.txt` (18,675 lines; file SHA-256 `13c2c2a8345cb48defb8e88783d7ae29e164bf3285498788af4c62f6cffa91ac`; generated with `git ls-files -z | xargs -0 sha256sum` at the merge).
- Bootstrap README, AGENTS.md, all spec/ and docs/handoff/ files retained (`git diff origin/main HEAD -- README.md AGENTS.md` empty; the 18 bootstrap files are all present in HEAD).

## Baseline

Environment: 4.1GiB RAM / 2 cores / no swap / 9.9G disk sandbox. pnpm 10.33.2 (corepack-pinned per packageManager field), node v24.22.2 (mise pin is 24.14.0; root engines >=24.0.0 satisfied), TypeScript 6.0.2, oxlint 1.57.x, oxfmt 0.41.x, vitest 4.1.x.

| Command | Result |
|---|---|
| `pnpm install` | PASS exit 0, 61s, 2680 packages, native builds OK (node-pty, ssh2, cpu-features, electron-rebuild); only core-js build script ignored (pnpm 10 policy) |
| `node scripts/check-workspace-freshness.mjs` | PASS exit 0 — "baseline fresh", branch ahead 10 / behind 0 vs origin/main |
| `pnpm bootstrap` | PARTIAL-FAIL exit 1 — `build:bootstrap` stage SIGKILL (OOM) at packages/web; all other packages then built PASS via serial continuation (`pnpm -r --workspace-concurrency=1 --filter './packages/*' --filter '!@zcode/desktop' --filter '!@zcode/web' build` exit 0) |
| `pnpm typecheck` | PASS exit 0 (~2m10s, full workspace tsc project references) |
| `pnpm lint` | PASS exit 0 — oxlint: 538 pre-existing upstream warnings, 0 errors, 5616 files; session-control boundary check passed |
| `pnpm fmt:check` | FAIL exit 1 — 1558 files flagged (1546 inherited from the pristine pin + 12 MOS bootstrap docs). Not part of upstream `verify:pre-push`; left unmodified in this PR (formatting adoption is an ACR decision) |
| `pnpm test:architecture` | PASS exit 0 |
| `pnpm db:schema:check` | PASS exit 0 — SQLite schema compatible (services project-storage + zcode-cli session store) |
| `pnpm docs:stale-phrases:check` | PASS exit 0 — 2287 files clean |
| `pnpm check:e2e-remote-targets` | exit 0 — tool's own graceful skip (private queue absent) |
| `pnpm test:engineering` | 1018 passed / 1 failed / 8 skipped, 96.7s. The one failure is `packages/desktop/test/miseToolchainEnv.test.ts` — environment-sensitive test expectation (assumes `dirname(process.execPath) != /usr/bin`; sandbox node lives at /usr/bin); the function under test behaves correctly per its dedup contract |
| `pnpm architecture:check -- --changed` | exit 1 — 7 unmanaged-new-file findings for `packages/zcode-cua/*.js` placeholder files: latent upstream module-registry gap that only surfaces when every path is "new" (first import PR). Upstream remediation (`pnpm architecture:adopt`) intentionally NOT run inside this import PR; to be resolved via ACR before W1-B/W1-C |
| `pnpm --filter @zcode/desktop build:no-runtime-assets` | FAIL — renderer vite build SIGKILL/OOM during chunk rendering after 8436 modules transformed (sandbox RAM) |
| packages/web `vite build` (inside build:bootstrap) | FAIL — SIGKILL/OOM after 8565 modules transformed; also fails with `--minify false` → environment limit, not source (full typecheck passes) |
| `pnpm test:e2e` (desktop e2e) | SKIPPED — sandbox has no DISPLAY, no Docker, no Xvfb |

Explicit statement: a skipped or OOM-blocked command is not a pass. The renderer-scale builds and desktop E2E must be re-confirmed on adequate hardware/CI (>=16GiB RAM, display/Docker) before feature work relies on them. Everything that could run within the sandbox is green except the two inherited/environmental items above (fmt:check inherited file set; miseToolchainEnv PATH assumption).

## Preservation

- Initial feature inventory and area→path mapping: `docs/handoff/PRESERVATION-INVENTORY-v3.18.0.md` (all listed paths verified to exist at the pin).
- Handoff path claims verified: `packages/ui/src/NewTaskButtonGroup.tsx` EXISTS; `packages/ui/src/v4/composer/V4ComposerToolbar.tsx` EXISTS; `packages/contracts/src/plugins` DOES NOT EXIST in v3.18.0 (plugin contracts live in `packages/plugin-api/src/*` and `packages/services/src/plugins/*`) — W1 packages must use the real paths.
- No upstream tests, security controls (credential/permission services), licenses or packaging were removed or weakened; `git diff` against the pin shows zero upstream-file changes.
- Upstream state notes recorded for planning: zcode-cua is a fail-closed placeholder at v3.18.0; no upstream .github CI; upstream contains a `marketing-touch` service module that MOS must reconcile with rather than duplicate.

## Rollback

The import lives on branch `bootstrap/import-zcode-v3.18.0` and reaches `main` only through this PR's merge commit. Rollback path without force-push or history deletion:

1. `git revert -m 1 <merge-commit-sha>` on main — reverts the import's file changes while keeping both parent lineages intact (bootstrap commits remain in history).
2. The branch and the local tag `mos3-zcode-v3.18.0` can be deleted at any time; the upstream remote (`https://github.com/zai-org/ZCode.git`) remains authoritative for the source tree.
3. No force-update of main is required at any point; the pre-import main HEAD remains 3a1f50babca07a4b045634873c08d18d81d997e6.
