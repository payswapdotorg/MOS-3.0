# Upstream source import playbook — MOS 3.0

This playbook is mandatory because MOS-3.0 was created as an empty repository and then received an architecture bootstrap commit. The full ZCode application tree has not yet been imported.

## Desired Git topology

The resulting import commit must have both:
- the current MOS-3.0 bootstrap history as an ancestor; and
- the exact upstream ZCode v3.18.0 commit as an ancestor.

This preserves the architecture documents and the real upstream code/history. A file copy, subtree snapshot without lineage, detached clone, or force-push does not meet this requirement.

## Preconditions

- Confirm current MOS-3.0 main contains bootstrap commit e3c0fa0e2f477988441d283428b259c6409180f6 and current documentation commit 3e892ea05adc079461ff5609ad1b041dc4923180.
- Confirm worktree is clean.
- Re-fetch ZCode upstream and verify commit b95ebaffeab641907b38652f45c1502bd762972d exists and its source version/metadata match the pinned record.
- Reconfirm whether upstream main has advanced. Do not silently import the newer head instead of the pin.
- Use a new topic branch, never force-push or reset main.

## Suggested Git procedure

Run from a fresh clone of MOS-3.0:

    git clone https://github.com/payswapdotorg/MOS-3.0.git
    cd MOS-3.0
    git status --short
    git log --oneline --decorate --graph -10
    git switch -c bootstrap/import-zcode-v3.18.0

    git remote add upstream https://github.com/zai-org/ZCode.git
    git fetch upstream main --tags
    git cat-file -e b95ebaffeab641907b38652f45c1502bd762972d^{commit}
    git show --no-patch --format=fuller b95ebaffeab641907b38652f45c1502bd762972d
    git tag mos3-zcode-v3.18.0 b95ebaffeab641907b38652f45c1502bd762972d

    git merge --no-commit --no-ff --allow-unrelated-histories mos3-zcode-v3.18.0

Inspect all merge conflicts. The expected obvious conflict is README.md because both repositories have a README. Keep the MOS-3.0 README as the root product/source-of-truth entrypoint. Do not discard the upstream source tree. If desired, preserve the upstream README in docs/upstream/README-ZCODE-v3.18.0.md as historical source documentation.

For each other conflict:
- determine whether it is an upstream application file or a MOS architecture file;
- keep both by relocating only when a clear path collision exists;
- never blindly choose ours/theirs for entire directories;
- record every resolved path and rationale in the import PR.

Then complete the merge:

    git add -A
    git diff --cached --stat
    git diff --cached --check
    git status --short
    git commit -m "chore: import ZCode v3.18.0 substrate"

The commit must be a two-parent merge commit. Verify:

    git show --no-patch --format="%H%n%P%n%s" HEAD
    git merge-base HEAD b95ebaffeab641907b38652f45c1502bd762972d
    git log --oneline --graph --decorate --all -20

Expected: the merge base with the pinned upstream commit is the pinned commit itself, and the MOS bootstrap commit is also an ancestor.

Push the topic branch and open a PR:

    git push -u origin bootstrap/import-zcode-v3.18.0
    gh pr create --base main --head bootstrap/import-zcode-v3.18.0 --title "Import ZCode v3.18.0 substrate" --body-file docs/handoff/import-pr-body.md

Use a normal merge commit for this import PR. Do not squash or rebase it, because preserving the upstream parent lineage is an acceptance criterion. Do not merge until TL reviews the complete file/conflict report and bootstrap commit ancestry.

After merge:

    git fetch origin
    git switch main
    git pull --ff-only
    git fetch upstream main --tags
    git status --short
    git log --oneline --graph --decorate -20

## Import PR evidence

The PR must include:
- exact MOS base SHA and upstream source SHA;
- upstream main SHA observed at import time;
- upstream version and tree SHA;
- merge commit SHA and both parents;
- exact file-conflict list and resolution;
- confirmation that bootstrap README, AGENTS.md, spec and docs are retained;
- source inventory SHA-256 manifest;
- package manager/runtime/toolchain versions;
- install, lint, typecheck, build and test baseline commands/results;
- explicit failures/skips; do not hide failing baseline checks;
- initial preservation test matrix;
- rollback instructions.

## Acceptance checks

- MOS-3.0 main history retains the original bootstrap commit and docs commit.
- ZCode v3.18.0 source commit is an ancestor of MOS-3.0 main.
- ZCode's full code tree, scripts, tests, CI, licenses and notices are retained.
- MOS root README and architecture rules remain the product authority.
- No source paths were omitted because they looked unrelated to marketing.
- No upstream tests, security controls, permissions or packaging were removed.
- The repository builds using upstream instructions before any MOS feature code is added.
- source-baselines.yaml is updated with the exact import metadata and test results.

## If the merge topology cannot be achieved

Stop. Do not force a branch update and do not import by copying the current source tree alone. Present the exact Git error, repository state and a proposed alternative to the repository owner for decision. A source snapshot can be used temporarily for investigation but cannot be marked as the authoritative code fork.
