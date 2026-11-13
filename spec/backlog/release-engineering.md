# Release engineering — distributable MOS desktop application

**Status:** planned; no MOS desktop release is published yet  
**Owner:** Tech Lead (TL)  
**Canonical product:** MOS 3.0  
**Repository:** `payswapdotorg/MOS-3.0`

## Objective

Turn the existing ZCode-based MOS application into a reproducibly built, installable desktop product. The TL and repository CI build it. A user or local AI agent only discovers the current release, downloads the already-built installer for the host OS/architecture, verifies its digest, and invokes the normal operating-system installer.

The end-user machine must not need Git, Node, pnpm, source checkout, dependency installation, compiler toolchains, Electron build tools, or a local build step.

MOS remains the actual ZCode application extended in place. Preserve the entire general-purpose ZCode feature set and the original New Task/Composer journey. The distributable app must identify itself as **MOS**, not as a developer build of ZCode.

## 1. Release identity and installation isolation

1. Give MOS its own product name, application/bundle identifier, Linux executable/package name, shortcuts, icons, install directory, update channel and application data namespace. Use a stable MOS-owned identifier such as `org.payswap.mos`, after checking the platform conventions in the imported code.
2. MOS must install alongside upstream ZCode. It must never silently replace, downgrade, upgrade, or reuse ZCode's install identity or mutable user-data directory.
3. Keep the MOS release version independent from the pinned/imported ZCode version. Record both in the release manifest. Do not publish MOS with an upstream `v3.18.x` tag.
4. Production and preview channels must also have distinct identities and feeds. Preview cannot overwrite production.
5. Preserve existing MOS data across MOS upgrades. A ZCode data import/migration, if offered, must be explicit, backed up, and tested; never silently reuse or mutate an existing ZCode profile.
6. Product metadata, displayed app name, installer name, Linux package name, launch executable, tray/menu labels, file associations and auto-update identity must agree.

## 2. The MOS Studio plugin must ship inside the app

The current `packages/mos-studio` plugin is built as three outputs (`server.mjs`, `hook.mjs`, `ui/panel.html`). Its build script currently externalizes `@napi-rs/keyring` and `koffi` and describes an inline workspace-plugin layout whose dependencies resolve through workspace `node_modules`. That is not sufficient evidence for a standalone installed app.

Before release, the TL must:

- Build MOS Studio as part of the desktop release build, with its required ZCode adapter build prerequisites.
- Install the plugin through a supported built-in/packaged plugin location in the installed MOS application. It must be present and enabled by default; the user must not clone the repo, configure `plugins.dirs`, run a plugin build, or manually install it.
- Vendor/package or otherwise correctly resolve every runtime dependency, including platform-specific native modules. Do not leave workspace symlinks, source-tree paths, development-only environment variables or missing native binaries in the installed package.
- Ensure hook and MCP server commands resolve against the packaged app's resources on Windows, macOS and Linux.
- Keep secrets out of the plugin bundle. Provider credentials remain in the existing ZCode credential authority; only opaque references and runtime-injected auth material may be used.
- Preserve ZCode plugin trust, permission and side-effect approval checks. Packaging/auto-enabling MOS Studio is not approval to execute external provider actions.
- Prove the plugin loads from an installed package on a clean machine with no repository checkout or development dependencies.

A plugin that only works from the repository checkout is a release blocker.

## 3. Canonical distribution and release assets

Use GitHub Releases on this repository as the first-party distribution channel:

- Release page: `https://github.com/payswapdotorg/MOS-3.0/releases`
- Stable latest release page after a stable release exists: `https://github.com/payswapdotorg/MOS-3.0/releases/latest`
- Tags must be MOS-specific, e.g. `mos-v3.0.0-rc.1` for a release candidate and `mos-v3.0.0` for the first stable 3.0 release. Version selection must be machine-readable and documented.

Build artifacts for the OS/architecture targets actually supported by the CI runners and verified smoke tests:

| Platform | Required installer artifact | Additional artifact |
|---|---|---|
| Windows x64 | NSIS `.exe` | None required |
| Windows arm64 | NSIS `.exe` | Publish only after native/runtime smoke verification |
| macOS arm64 | `.dmg` | `.zip` |
| macOS x64 | `.dmg` | `.zip` |
| Linux x64 | `.AppImage` and `.deb` | `.rpm` and `.pkg.tar.zst` when packaging dependencies are available |
| Linux arm64 | `.AppImage` and/or `.deb` | Publish only after native/runtime smoke verification |

The current Electron Builder configuration already declares macOS DMG/ZIP, Windows NSIS EXE, and Linux AppImage/DEB/RPM/Pacman targets. The TL must verify real artifact output for each target; configuration declarations alone are not release evidence. Prefer native architecture runners for native module preparation and packaging. Do not cross-compile a target with incompatible native dependencies and call it supported.

If a target cannot be built and smoke-tested, omit it from the supported download matrix and state the limitation explicitly. Do not upload placeholder or mislabelled installers.

Use versioned, unambiguous asset names, for example `MOS-3.0.0-rc.1-linux-x64.AppImage`, `MOS-3.0.0-rc.1-linux-x64.deb`, `MOS-3.0.0-rc.1-win-x64.exe`, `MOS-3.0.0-rc.1-mac-arm64.dmg`. Names must encode product/version/platform/architecture/format.

## 4. Build and publication automation

Add repository-owned GitHub Actions workflows (or an equally reviewable repository-native CI system) for:

### Pull request / main CI
- Validate repository gates, typechecks, lint, architecture policy, documentation checks and applicable engineering tests.
- Build MOS Studio and verify its runtime closure.
- Build desktop app/package candidates on the required native runners.
- Run package and installer smoke tests.
- Upload build logs and artifacts for inspection; PR jobs must not publish a public release.
- Use least-privilege job permissions, pin third-party actions to immutable commit SHAs, avoid exposing release/signing secrets to fork PRs, and retain useful build/test artifacts.

### Tagged release
- Trigger only from an explicit MOS release tag matching the documented pattern (plus an intentional manual dispatch for a draft/RC path).
- Check out the exact tag commit; verify it belongs to the reviewed `main` history and record its full SHA.
- Build every declared platform/architecture from clean CI jobs using the pinned Node and pnpm versions and frozen lockfile.
- Run the relevant tests and package verification before artifact publication.
- Collect only successful, validated installers. Fail the release if a required target, manifest entry, checksum, or required smoke test is missing.
- Generate `SHA256SUMS` after the final package bytes are fixed. Verify every listed digest again before publication.
- Generate a machine-readable `release-manifest.json` containing at least: MOS version/tag, source commit SHA, ZCode upstream baseline/version, build run identifier, build timestamp, OS, architecture, artifact filename, format, byte size, SHA-256, minimum OS/runtime requirements, and signature status.
- Produce GitHub build provenance/attestations for release artifacts where supported. Do not claim an attestation exists until CI verifies it.
- Create a draft GitHub Release with installer assets, `SHA256SUMS`, `release-manifest.json`, concise platform install notes, known limitations and source commit. Publish only after the release gate passes and the designated reviewer approves.
- Keep the release tag immutable after publication. A corrected build requires a new version/tag; do not silently replace release binaries.

### Reproducibility
- The build must work from a clean clone without pre-existing `dist/`, `out/`, `node_modules`, local plugin state or cached build outputs.
- Cache may accelerate CI but must never be required for correctness.
- Record exact command, runner image, tool versions, environment, result and log/artifact references in the release evidence ledger.
- Do not convert the known `miseToolchainEnv` baseline failure or `@zcode/contracts` dist dependency gap into a green claim by hiding/skipping them. Fix them or clearly separate and justify a narrowly scoped baseline exception without suppressing other tests.

## 5. Signing, integrity and updater safety

- SHA-256 checksums are mandatory for every release.
- Sign and notarize macOS builds and sign Windows installers when the required organization credentials and platform services are configured. Signing credentials belong in protected CI secrets or a suitable signing service, never in Git or build artifacts.
- If signing credentials are not available, mark the candidate explicitly unsigned and document the OS security prompts. Do not claim signed, notarized or trusted. An unsigned RC is acceptable only as an explicitly approved preview, not as a silently promoted stable release.
- Record signature verification results and certificate identity in the release evidence.
- Do not ship an auto-update feed that resolves to a placeholder such as `http://localhost:8081`, or to upstream ZCode's feed. Implement and verify a MOS-specific update manifest/feed, or leave automatic updates disabled with a clear manual-update path until it exists.
- A release must never update the upstream ZCode installation or point at upstream ZCode manifests.

## 6. Install and runtime acceptance

For each published OS/architecture artifact, use a clean VM or machine/profile that does not contain the MOS source checkout or development dependencies.

Required acceptance:

1. Download the artifact from the GitHub Release asset URL and verify its SHA-256 against `SHA256SUMS` and `release-manifest.json`.
2. Install using the platform's normal installation mechanism. Do not invoke pnpm, Node or a build script on the target machine.
3. Confirm OS application identity, package metadata, icon, shortcuts and executable name identify MOS and do not collide with upstream ZCode.
4. Launch successfully after install and after a full machine/app restart.
5. Confirm the installed package contains and auto-loads MOS Studio; inspect the packaged plugin manifest, hook, MCP server, panel and runtime/native dependency closure.
6. Confirm MOS Studio has a usable session/mission context and fails safely when the user has not connected a provider.
7. Confirm the original ZCode New Task/Composer, model selector, conversations, terminal, browser, files, tools, permissions and settings still work.
8. Confirm an ordinary New Task remains usable when MOS is disabled or a MOS plugin error occurs.
9. Confirm MOS data persists across an application restart and an in-place MOS upgrade; confirm an installed ZCode profile remains untouched.
10. Capture test logs, package inspection, OS/version/architecture and screenshots or recordings only where allowed. Never include credentials or personal data.

At least one complete live-provider journey should remain independently evidenced using the existing Composio proof. Release smoke tests must not require publishing a user's data or making unauthorized external writes.

## 7. Simple consumer download contract

A local AI agent is a consumer of the published release, not a builder.

It must be able to:
1. Query the repository's latest stable GitHub Release metadata (or the latest approved RC metadata when explicitly requested).
2. Detect host OS and CPU architecture.
3. Select exactly one compatible installer from `release-manifest.json`.
4. Download the installer and checksum file from the release assets.
5. Verify SHA-256 before execution.
6. Invoke the normal platform installer with the user's authorization where administrative privileges are required.
7. Launch MOS and report installed version, source commit, package digest and installation result.

The agent must not clone the repository, install Node/pnpm, compile code, create the MOS Studio plugin, edit user configuration by hand, or silently replace an existing ZCode install.

The release page and manifest must be sufficient for this workflow. The handoff to an agent should reduce to a repository URL plus OS/architecture detection.

## 8. Required release evidence and source-of-truth updates

Before marking this backlog verified, TL must commit:

- Release workflow(s), scripts and their tests.
- MOS desktop product identity and collision tests.
- Packaged MOS Studio plugin integration and native dependency closure.
- Release manifest/checksum/provenance generation and validation.
- Platform-specific installer smoke tests and a clean-machine acceptance record for every published target.
- A release candidate or stable GitHub Release with real downloadable installer assets.
- Updated `README.md` with the release link and supported download matrix.
- Updated `docs/handoff/IMPLEMENTATION-STATE.md` with the exact tag, commit, assets, SHA-256 values, signatures, test evidence and unsupported targets.
- Rollback and recovery notes.

Completion vocabulary follows `AGENTS.md`: planned → scaffolded → contract-tested → integrated → verified. Docs, green unit tests, a successful bundler dry-run or an installer artifact without a clean-machine launch do not qualify as verified.

## 9. Non-goals for this release stage

- Do not redesign the application shell or replace the ZCode UI.
- Do not introduce a second model router, credential authority, tool executor, workflow engine or plugin marketplace.
- Do not attempt to solve every deferred Studio production surface or every provider connector before producing the first installable MOS candidate.
- Do not use the local AI agent as the build/release operator.
- Do not silently import an upstream ZCode release into MOS; upstream synchronization remains a separate reviewed source-change workstream.
