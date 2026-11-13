# FINAL TL HANDOFF — Build and publish the distributable MOS desktop application

**Repository:** https://github.com/payswapdotorg/MOS-3.0  
**Target branch:** `main`  
**Product:** MOS 3.0 (the ZCode application extended in place)  
**Owner:** Tech Lead  
**Priority:** Next release-engineering milestone  
**Status at handoff:** Architecture and MOS packages are merged; no MOS desktop installer or GitHub Release has been published.

## 0. Mission

You are the TL. Build, test, package and publish the modified ZCode application as a real MOS desktop product.

The user's requirement is that the later local agent should download and install MOS as easily as a user downloads and installs a published ZCode release. The local agent is only the installer consumer. It must never be asked to clone this repository, install development toolchains, build Electron, compile MOS Studio or assemble an installer.

Your deliverable is a GitHub Release in `payswapdotorg/MOS-3.0` containing tested, platform-specific MOS installers, SHA-256 checksums and a machine-readable release manifest. The application must identify itself as MOS, contain the MOS Studio plugin, preserve ZCode's general-purpose functionality, and install separately from upstream ZCode.

Read first:
1. `AGENTS.md`
2. `README.md`
3. `spec/architecture/architecture-v3.0.md`
4. `spec/architecture/decision-lock-v3.0.md`
5. `spec/architecture/preservation-contract.md`
6. `spec/architecture/source-baselines.yaml`
7. `spec/architecture/module-registry-v3.0.yaml`
8. `spec/backlog/release-engineering.md`
9. `docs/handoff/IMPLEMENTATION-STATE.md`
10. `packages/mos-studio/CONTRACT.md` and its plugin manifest/build script
11. `packages/desktop/package.json`, `packages/desktop/electron-builder.config.js`, `packages/desktop/scripts/bundle.mjs`, `packages/desktop/scripts/desktop-product-identity.mjs`

The repository is the only source of truth. Correct stale handoff text only after confirming it against current source and committed evidence.

## 1. Baseline and current blockers to resolve

Start from a clean clone and verify the live `main` SHA. Do not assume that a previous sandbox or report is current.

Known facts from the source audit:
- The repository currently packages the imported ZCode desktop application with Electron Builder.
- The desktop package declares macOS DMG/ZIP, Windows NSIS EXE and Linux AppImage/DEB/RPM/Pacman targets.
- `packages/desktop/scripts/bundle.mjs` defaults to macOS/arm64 when explicit targets are omitted. Pass target OS and architecture for every build.
- Root toolchain is pinned in `mise.toml`: Node 24.14.0 and pnpm 10.33.2.
- Root package requires Node >=24 and `pnpm@10.33.2`.
- `packages/mos-studio/scripts/build.mjs` produces `dist/server.mjs`, `dist/hook.mjs`, and `dist/ui/panel.html`; `@napi-rs/keyring` and `koffi` remain external native dependencies. The package documentation describes an inline workspace-plugin layout. This is not yet proven to work in a clean installed application.
- `packages/mos-studio/.zcode-plugin/plugin.json` defines an MCP server, a session surface and nav/side-pane slots. The installed desktop must actually discover and load it.
- Current desktop product identity code still names the product ZCode / ZCode Preview. It is not yet a separate MOS desktop identity.
- No GitHub Releases exist for MOS-3.0.
- The upstream repository's published v3.17.2 release provides a useful distribution precedent: OS/architecture-named installer assets and a SHA256SUMS file. MOS must implement its own independent releases, version identity and updater path.
- The imported ZCode pin is v3.18.0. Upstream has since advanced. Do not combine upstream synchronization with this release task unless a separate reviewed change explicitly authorizes it.

Do not confuse an existing Electron Builder target declaration or a successful local bundle with a distributable product. A packaged app can still omit its built-in plugin, a native dependency, a required runtime asset or a correct app identity.

## 2. Product and installation identity

Ship the app as **MOS**.

- Replace the installed product label and platform package identity with a MOS-specific identity.
- Use a collision-free application/bundle identifier in a MOS-owned namespace (proposed `org.payswap.mos`; verify before adopting).
- Give Linux a MOS-specific executable, package name and desktop entry.
- Set the icons, shortcuts, install path, tray name, updater channel and app metadata consistently.
- Keep the MOS release version independent from ZCode's imported application version.
- Ensure an existing ZCode installation, user profile, application data, shortcuts and updater configuration are untouched.
- Ensure MOS upgrades preserve the MOS profile. Any import from ZCode must be opt-in and backed up.
- Keep production and Preview separate. A Preview build must never overwrite the production app.

Write identity resolver tests for Windows, macOS and Linux. Verify the actual built installers and installed OS metadata, not just pure helper functions.

## 3. Package MOS Studio into the installed application

This is a critical release gate.

The existing plugin's workspace-oriented runtime closure is not sufficient. Implement a supported bundled-plugin installation path that:

1. Runs the real MOS Studio build during the desktop build.
2. Builds required ZCode adapter dependencies in the correct order.
3. Includes the plugin manifest, MCP server, SessionStart hook, panel assets and every runtime dependency in the packaged application.
4. Includes or resolves the native `@napi-rs/keyring` and `koffi` modules for the exact target OS/architecture.
5. Does not depend on a repository checkout, workspace symlink, developer `node_modules`, global plugin folder, manually edited `plugins.dirs` setting or development-only environment variable.
6. Enables the supported built-in MOS plugin by default while retaining the existing plugin trust/permission model.
7. Resolves `ZCODE_PLUGIN_ROOT` and packaged resources correctly on all targets.
8. Fails the build if a required MOS plugin asset or native module is missing.

Use the actual ZCode plugin discovery/loader contracts. Avoid a second plugin system. Do not bypass existing trust or permission gates. A clean-installed app must have the MOS Studio surface and session hook before any provider is connected; an unconfigured provider should simply leave provider-dependent capabilities unavailable.

Add a package inspection test that opens the final app/package and asserts that every plugin file and runtime dependency is present. Then run the real loader against the packaged plugin. A test that runs from `packages/mos-studio` is not sufficient.

## 4. Build/release automation

Implement repository-owned CI for both PR validation and release publication.

### PR/main validation
- Run clean-clone installation using the pinned Node/pnpm.
- Run MOS package typechecks/tests, Studio integration typecheck, lint, architecture checks and applicable engineering tests.
- Build MOS Studio and the desktop bootstrap.
- Package each supported target on an appropriate native runner.
- Run desktop installer/package smoke checks and applicable E2E coverage.
- Preserve logs and test artifacts.
- Never publish public installers from an untrusted PR.
- Use least-privilege workflow permissions and immutable action references.

### Release workflow
- Trigger on a documented MOS-specific semver tag, for example `mos-v3.0.0-rc.1`.
- Verify that the tag points to the exact reviewed commit on `main`.
- Use a native runner per OS/architecture wherever native modules/build dependencies require it.
- Build all declared targets. The matrix must be explicit; no hidden skipped targets.
- Generate checksums and manifest only after the final installer bytes are produced.
- Re-verify hashes and package contents before release creation.
- Create a draft release first. Publish only after package and clean-machine checks pass.
- Record source SHA, imported ZCode baseline, build run ID, toolchain, target, byte size, checksum, signature status and known limitations.
- Use GitHub artifact provenance/attestation where supported and verify it before claiming provenance.
- Never overwrite binaries on a published tag. A corrected build gets a new version.

Release file names, target list, checksums, manifest schema and consumer contract are specified in `spec/backlog/release-engineering.md`.

### Required toolchain
Use the repo pins: Node 24.14.0 and pnpm 10.33.2. Do not upgrade the toolchain as incidental release work.

### Signing
Use protected CI secrets or a supported signing service for Windows signing and macOS codesigning/notarization. Never commit signing credentials. Report missing signing credentials as a blocker/explicit unsigned preview; do not call an unsigned binary trusted or signed. Do not promote an unsigned package to a stable channel without an explicit product-owner decision.

### Auto-update
The current desktop configuration has a generic publish placeholder and comments describing a newer server-side manifest path. Verify the actual runtime before release. Never leave a MOS installer pointing at `localhost:8081` or upstream ZCode's feed. Implement and verify a MOS update manifest or disable auto-update until it is ready.

## 5. Platform targets

Use the actual electron-builder config and prove every artifact exists. Initial target matrix:

- Windows x64: NSIS `.exe`
- Windows arm64: NSIS `.exe` after native module and clean install validation
- macOS arm64: `.dmg` and `.zip`
- macOS x64: `.dmg` and `.zip`
- Linux x64: `.AppImage` and `.deb`; add `.rpm` and `.pkg.tar.zst` when supported by the runner/toolchain
- Linux arm64: publish only after native package/runtime checks pass

Use native architecture builds where feasible. If a matrix member is not supported, remove it from the advertised matrix and include the reason in the release notes. Never silently cross-compile a broken native dependency tree.

For every bundler invocation pass explicit `--os` and `--arch`; the bundler otherwise defaults to macOS/arm64.

## 6. Workstream ownership

Maximum three parallel worker workstreams. TL retains architecture, product identity decisions, MOS Studio composition/packaging integration, final branch merges and release approval.

**Worker A — Release automation**
- Own: new `.github/workflows/mos-*.yml` files and new `scripts/release/**` files only.
- Deliver: PR CI, tagged release matrix, checksum/manifest/provenance generation, draft release publication logic and test coverage.
- Forbidden: editing desktop product identity or MOS Studio implementation.

**Worker B — Desktop identity and bundled plugin**
- Own: `packages/desktop/**` and `packages/mos-studio/**` only.
- Deliver: MOS branding/identity, distinct app IDs and data isolation, plugin packaging/runtime closure, native dependency handling and package inspection tests.
- Forbidden: changing shared MOS contracts, architecture registry or release workflows.

**Worker C — Clean install and platform verification**
- Own: new `scripts/release-smoke/**`, new release QA docs under `docs/release/**`, and assigned tests only.
- Deliver: install/launch smoke harnesses, OS metadata checks, upgrade/no-collision tests, evidence format and clean-machine runbook.
- Forbidden: changing product identity, plugin runtime or workflow files.

TL owns shared files such as root package scripts, lockfile coordination, README, implementation state and any central architecture decisions. Reassign paths explicitly before any worker edits. Do not allow overlapping ownership.

## 7. Mandatory acceptance sequence

1. Verify clean `main` SHA, working tree, upstream pin and local build dependencies.
2. Fix the fresh-clone `@zcode/contracts` dist-build prerequisite and record the pre-existing `miseToolchainEnv` failure accurately. Do not hide failures.
3. Build MOS Studio and prove it runs from a packaged-resource directory outside the repository.
4. Build the desktop app from a clean clone with frozen dependency installation.
5. Verify that the final artifacts exist for every advertised OS/architecture and have the expected names and nonzero sizes.
6. Inspect package contents for `app.asar`, plugin assets, hook/server/panel and native dependency closure.
7. Install each artifact on a clean supported OS image. No source checkout, Node, pnpm or developer dependencies on the test machine.
8. Launch and test after app restart. Verify MOS identity, bundled MOS Studio, ordinary ZCode tasks, New Task/Composer and major preserved functions.
9. Verify existing ZCode installation/profile remains intact when MOS is installed and run.
10. Verify an in-place MOS upgrade preserves MOS data and does not change ZCode.
11. Generate `SHA256SUMS` and `release-manifest.json`; independently recalculate every hash after upload.
12. Publish a draft RC, inspect the public assets/URLs from a clean client, then publish the approved release.
13. Update README and `docs/handoff/IMPLEMENTATION-STATE.md` with the actual public Release URL, tag, source SHA, files, hashes, signatures, unsupported targets and all test results.

## 8. Required completion report

Return a graph with green checks only beside verified work. Include:

- MOS release tag and exact source commit SHA.
- Public GitHub Release URL.
- Every published installer filename, OS/architecture, size and SHA-256.
- Signature/notarization status by platform.
- Toolchain and CI runner identity.
- Commands, exact test counts/results, clean-install and restart/upgrade results.
- Evidence that MOS Studio loads from the installed package without a source checkout.
- Evidence ZCode and MOS can coexist without data/profile collision.
- Explicit target omissions, blockers and remaining limitations.

Do not close this milestone based on a successful build alone. The exit criterion is a user-downloadable release that installs and starts cleanly on every advertised target.

## 9. Consumer handoff (local AI agent)

Once a release exists, the local agent receives only:

- Repository: `payswapdotorg/MOS-3.0`
- Release selection: latest stable, or the explicitly named RC
- Host OS and CPU architecture

The local agent queries release metadata, selects a matching file from `release-manifest.json`, downloads it, verifies SHA-256, installs using the operating system's normal mechanism with the user's authorization, launches MOS and reports the installed version/digest. It must not clone/build the source.

**The TL owns building and publishing MOS. The local agent owns only downloading, verifying and installing the published artifact.**
