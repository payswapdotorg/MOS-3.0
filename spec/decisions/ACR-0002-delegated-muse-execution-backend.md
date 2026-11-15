# Architecture Change Record — ACR-0002

**Status:** accepted (rev. 2 — PR #27 external review revisions R1–R7; rev. 3 — verification-round corrections; rev. 4 — MC-D selection-driven routing)
**Owner:** TL (payswapdotorg)
**Date:** 2026-11-14 (rev. 2: 2026-11-14; rev. 3/rev. 4: 2026-11-15)
**Related PR / issue:** Issue #24 (P0, Integrate Muse Code Contributor CLI into MOS New Task); PR #27（rev. 2 随附）
**Affected modules/contracts:** packages/shared（muse-code 契约、v4 信封字段、runtime capability、channel）、packages/services（IMuseCodeService）、packages/client、packages/ui（设置分区/Composer 指示器/信封门控）、apps/zcode-cli/packages/contracts（MuseExecutionPort）、apps/zcode-cli/packages/core（delegated turn 执行器 + turn 路由）、apps/zcode-cli/packages/bootstrap（执行端口（双面）+ JSONL 映射 + MSP 会话端口 + 会话映射存储 + capability + v4 命令门控）

## Context

用户已在本机安装并订阅登录了 Meta 的 Muse Code CLI（Muse Spark Contributor 模式）。当前 MOS New Task 只能通过 provider Registry 的 HTTP 模型（OpenRouter/Zen 免费模型路径）执行。Issue #24 要求：在 Model Settings 选择「Meta Muse / Muse Spark Contributor」，并在 New Task 里直接消耗本机 CLI 的既有订阅登录——不经 OpenRouter、不创建按量计费的 Meta Model API key。

关键事实（Issue #24 调查结论）：
- Meta 的订阅额度只随 Muse Code CLI 生效；单独创建 API key 会切换到按量计费，即使使用 Contributor model ID 也一样。
- Provider Registry 的 provider schema 是 HTTP-only 的 fail-closed 枚举（`providerApiTypeDataSchema` + `completeProviderApiDataSchema` 强制 URL baseUrl），上游曾**刻意移除**第三方 CLI agent provider 并收敛到单一 ZCode agent provider（`zcode-agent-policy.ts`）。
- Muse Code 本身是完整 agent（自带工具环），不是裸推理端点；`muse exec --json` 以 JSONL 事件流形式输出。

## Current locked decision

- decision-lock-v3.0.md #4「**No parallel model router.** Model/provider invocation and user selection remain in ZCode.」
- decision-lock-v3.0.md #5「**No parallel workflow engine.** MOS keeps durable domain job state, not a second generic executor.」
- AGENTS.md §4「Do not add a database, ORM, runtime, scheduler, workflow engine, **model router, tool executor, permission authority or provider SDK layer without an ACR**」与「No direct provider SDK calls from MOS domain code」。
- AGENTS.md §2 / preservation-contract：New Task、Composer、模型选择与 session 生命周期不得替换。

## Proposed decision

新增一类**委托执行后端（delegated execution backend）**：`executionBackend: "muse-code"`（v4 信封级 additive 字段，缺省 = 普通 ZCode 模型轮，行为零变化）。它不是 provider、不进 Registry、不是 model router：

1. **路由**：当信封携带该字段且 CLI capability（`runtime/capabilities.executionBackendMuseCode`）声明支持时，CLI 的 v4 命令层把**该轮**交给 `MuseExecutionPort` 执行；普通轮、provider Registry、模型选择与权限系统完全不动。字段缺省时全部代码路径不变（纯 additive）。
2. **单执行环**：委托轮不创建 provider Model、不调用本进程工具执行器/权限代理；Muse CLI 在自己的会话里执行工具，其 JSONL 事件**只读投影**为标准 SessionEvent（assistant 文本流 + ToolCallStarted/Result 活动行）。MOS 不重放、不审批外部 agent 的工具调用——这正是「不产生双工具环」的边界。
3. **生命周期复用**：委托轮在 `executeTurnCommand` 主链内分支（compact/rewind 同型先例）：复用 TurnStarted/TurnComplete、session 持久化、冷恢复（text part 落库）、foreground execution（Stop 按钮/`expectedForegroundExecutionId` 不变）与 MOS Studio mission linkage（SessionStart hook 路径不变）。
4. **进程纪律**：子进程由 bootstrap 端口持有（cwd=会话工作目录、显式 argv、不 shell、Windows 不 spawn .cmd shim、POSIX 进程组/Windows taskkill /T 树终止、超时与 stderr 上限），对齐 `zcodeStdioTransport` 的收口语义。
5. **凭据红线**：MOS 不读取、不复制、不展示 CLI 的任何凭据；登录态只来自 `muse --version` 与用户显式配置的 documented 探针命令的可观察输出；auth/contributor 未知即显示未知。
6. **双门控**：renderer 只有在「用户意图（Host 设置）+ 本会话 CLI capability 确认」同时成立时才携带信封字段；旧 CLI 会静默剥掉未知字段退回普通模型执行（静默改道），capability 门控是唯一防线。
7. **fail-closed 准入**：委托轮不可 steer/queue——busy/queue/guide/choice/抢占路由在 ACK 前拒绝；端口缺失、可执行缺失、非零退出、超时、流内 error 均显式失败。

**已拒绝的替代方案**：
- *作为 provider 进 Registry（新 api type + 本地 LanguageModel 适配）*：需要破坏 HTTP-only fail-closed 枚举、违背上游移除 CLI provider 的既有决策、且把订阅登录伪装成 model provider——事实与架构双重不诚实。
- *Host 侧独立会话通道*：绕过 v4 会话投影，制造平行会话记录与第二套 UI 生命周期，违反 preservation-contract「do not fork or duplicate the conversation record」。
- *Meta Model API 直连（OpenAI-compatible）*：按量计费，正是用户明确排除的路径；保留为可选独立 provider，不在本 ACR 范围。

## Impact analysis

- ZCode preservation / existing feature impact：纯 additive。字段缺省时无行为变化；New Task/Composer/模型选择/权限/MCP/插件全部原样。普通轮的 `executeTurnCommand` 收口块改为读取两分支共用的 `turnOutcomeSummary`（值语义不变）。
- New Task / Composer / shell impact：Composer 增加常驻指示器（enabled 时显示）；委托轮的输出/工具活动在既有会话视图渲染（同 assistantText/toolCall 行）。
- Runtime, permission, plugin, model or workflow authority：模型/工具/权限权威不动。Muse 的工具活动是只读遥测，不经 MOS 权限系统；委托轮的会话 cwd 即文件系统边界。
- Domain module authority and dependency graph：MOS 域模块零改动；全部落在 ZCode 既有层（shared/services/client/ui/contracts/core/bootstrap）与新增的端口/服务/分区文件。
- Data model, migration and historical compatibility：无 schema 迁移。v4 信封字段与 runtime capability 均为 optional（旧端剥除语义已由 capability 门控覆盖）；委托轮产生的消息/事件沿用现有持久化结构（providerId=muse-code, modelId=muse-exec, finish=muse_turn_*）。
- Provider API, credential and tenant/privacy impact：无 provider API 调用、无凭据接触。CLI 状态只来自可观察进程输出；日志与状态对象不含 token/cookie/env。
- Security, trust and sandbox impact：无 shell、显式 argv、prompt 经临时文件传递、进程树强制终止、输出/摘要上限；外部 agent 的工具活动对 MOS 不可见修改细节（只投影摘要）。
- Cost, latency, quotas and operational impact：消耗用户既有 CLI 订阅（无按量计费路径）；单轮默认 30 分钟超时（可配）；`--max-model-steps` 可选上限。
- Web, desktop and remote client impact：设置分区与 Composer 指示器为 desktop-only（DESKTOP_ONLY_SETTINGS_SECTIONS）；mobile/web-remote 的 channel 面默认 fail-closed，信封门控在未确认 capability 时不携带字段。

## Implementation and migration

PR 落地顺序：shared 契约（schema/字段/capability/channel）→ contracts 端口 → core 委托轮 + turn 路由 → bootstrap 进程端口 + JSONL 映射 + capability + v4 门控 → Host 服务 + 注册/访问器 → UI（设置分区/指示器/门控/i18n）→ 测试与 policy admission。无数据迁移；回滚 = 关闭设置开关（信封字段不再携带，零行为差异）。

## Tests and evidence

- 契约测试（本仓库，mock）：`apps/zcode-cli/packages/bootstrap/tests/muse-exec-jsonl.test.ts`（16 中 6）、`muse-exec-process.test.ts`（mock CLI：流式/取消/超时/退出码/未知计数）、`apps/zcode-cli/packages/core/tests/delegated-muse-turn.test.ts`（事件投影/持久化/取消/失败收口）、`packages/services/test/museCodeService.test.ts`、`packages/ui/test/museCodeBackendStamp.test.ts`。
- 回归：core turn 相关 63 例、bootstrap v4 命令 81 例、architecture governance 61 例通过。
- 在机验证（Issue #24 §5，尚待执行）：Windows 真实 CLI 的登录/Contributor 探测、真实任务端到端（流式/Stop/mission linkage/重启持久化/无 OpenRouter 流量），证据回填 `spec/integrations/provider-evidence/muse-code-connector-evidence.md`。

## Rollback

关闭 Model Settings 的「Use Muse Code as the New Task backend」（renderer 停止携带信封字段；所有轮回到普通模型路径）。彻底回滚可 revert 本 PR——无数据迁移、无凭据残留。

## Revision 2 (2026-11-14, PR #27 external review R1–R7)

External review verdict on rev. 1: "Do not merge yet — a contract-tested prototype of the
delegated execution path, not a proven integration of the user's existing Muse Code
experience." Seven ordered revision requirements, all addressed in this revision (numbering
note: review item 3 maps to R3+R4 below; review item 6 to R7 plus the rebase/CI/evidence
chain; review item 7 to the roadmap guardrail that closes this section):

- **R1 — official execution surfaces, pinned and contract-tested.** The delegated execution
  port now has **two official surfaces** selected at runtime (`shared
  selectMuseExecutionSurface`; explicit setting override > auto version gate):
  1. **Muse Session Protocol (MSP)** — `muse serve` + the official TypeScript SDK
     `@muse-code/sdk`, **exact-pinned `1.4.20`** (SDK and CLI "version in lockstep with Muse
     Code" per the official README — exact pin, never a `^` range). Auto-selected only when
     the installed CLI version **exactly matches** the pinned pairing (`muse --version`
     probe, cached in-process, probe failure = conservative fallback; rev. 3 — the lockstep
     rule is X.Y.Z↔X.Y.Z, not ≥; no forward-compatibility is assumed). This surface is itself
     **developer preview** per Meta — recorded as a known admission, with the exec fallback
     always available.
  2. **`muse exec --json`** — the documented headless surface available on every CLI version;
     remains the compatibility fallback (old/unknown CLI version, explicit override).
  The hand-rolled JSONL-only adapter is no longer the primary integration claim; the actual
  surface used is reported per-turn (`result.surface`) for honest attribution.
- **R2 — Muse session continuity.** A durable MOS-session ↔ Muse-session map
  (`~/.zcode/v2/muse-code-sessions.json`, atomic writes, tolerant reads, size-capped,
  survives MOS restarts). MSP surface resumes via the SDK's `resumeSession`; exec surface
  resumes via the documented `--session-id`. The mapping is written as soon as a Muse session
  id is observed (a failed first turn still leaves a resumable session). No id is ever
  invented; a missing mapping simply starts a fresh session.
- **R3 — approval posture, never auto-approve.** New setting `approvalPosture` (Meta's docs
  require choosing an unattended posture in advance for headless runs):
  - `fail-closed` (default): exec surface passes **no** approval flags (an unanswered prompt
    is bounded by the overall timeout); MSP surface registers an approval callback that
    **only ever selects a server-offered non-approving choice** (`denied` /
    `deniedPolicyAmendment` / `abort`); if no non-approving choice is offered, the handler
    throws — the approval stays open and the turn is bounded by the timeout. The SDK's own
    default is deny, which this posture preserves.
  - `unattended-sandboxed`: exec surface adds the documented `--disable-approval`
    (sandbox stays on); MSP surface uses `approvalMode: "allowAll"` (sandbox still applies
    independently).
  Approval requests and agent questions are projected as visible session activity rows
  (never answered on the user's behalf); counts are reported in the turn result, message
  metadata, and logs. **`--yolo` and sandbox-disable never appear in any argv** (red line).
- **R4 — workspace boundary.** `MuseExecRequest.workspaceRoot` is the policy boundary.
  MOS-side containment validation (`workingDirectory` must be inside `workspaceRoot`;
  normalization for win32 separators/drive case; rev. 3 adds a physical realpath re-check so
  a symlink/junction that is lexically inside but physically outside is also rejected) runs
  before any spawn — violations reject with a stable `workspaceViolation` issue code. MSP
  surface passes the root as the official `session/start` `workspaceRoot` (single root) /
  `workspaceRoots` (cwd is a subdirectory; first root = CWD, all roots receive the ADR
  `:workspace_roots` rules). The exec surface passes the documented `--workspace
  <workspaceRoot>` flag (rev. 3 correction — Meta's current configuration documentation
  lists it as a common flag for interactive and headless execution; the rev. 2 claim that
  the flag does not exist was wrong) so the CLI-side boundary is pinned to the same policy
  root, on top of cwd containment and Muse's own sandbox (which stays enabled).
- **R5 — child-process environment isolation.** `shared/node buildMuseChildEnv` builds the
  Muse child environment from a tested allowlist (process bootstrap + user-profile dirs for
  the CLI's own login state + locale + `MUSE_*` passthrough). Host integration credentials
  (`GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `*_SECRET`, …) never enter the delegated agent's
  process tree. Applied uniformly: exec surface, MSP host spawn, version probe, status
  probes, and the login launcher.
- **R6 — honest usage accounting.** Delegated turns record `cost: null` (unreported) —
  never `0`, which downstream readers would misread as free/zero consumption. The protocol
  schema widens `cost` to `number | null` for all messages (additive; normal model turns
  keep numeric costs). Token usage is mapped when the port reports it (MSP `turn/completed`
  TokenUsage); message metadata carries `museExecution.usageReporting: "reported" |
  "unreported"` plus the Muse session id, surface, resume flag, approval/question counts,
  and (best-effort) the subscription usage window snapshot (MSP `usage/read`). The Composer
  disables model selection while the backend is active with an explicit lock reason (the
  selected model is not used for delegated turns) instead of silently ignoring it.
- **R7 — verification chain on the rebased head.** Rebased onto `main@703fd7bd` (RC3
  publication entry preserved through the shared-file overlap); the full chain was run
  locally on the revision head (see the evidence record §2): affected package builds,
  `tsc -b` (shared/services/client/ui), muse contract suites (bootstrap exec/JSONL/MSP,
  core delegated turn, services, ui stamping), core turn/admission regressions, the full
  bootstrap v4 command suite, the full engineering suite, lint, architecture governance
  tests, architecture check (zero new violations vs `main`), release tests, doc-stale-phrase
  check, and the SQLite schema contract check. GitHub CI + review on the pushed head remain
  required before merge (local runs are not CI evidence).
- **Roadmap guardrail (review item 7 — normative, forward-looking).** Muse Code remains an
  **optional host capability**, nothing more:
  - *Optional by construction*: Settings opt-in + per-session capability gate; the envelope
    field is absent by default and every default path is unchanged. No MOS feature may
    require the Muse Code CLI to be installed, signed in, or reachable — market-intelligence
    functionality in particular must never depend on its presence, version, or roadmap.
  - *Scoped to New Task*: the delegated backend exists only inside New Task sessions for the
    user's own coding work. This ACR does not authorize turning MOS into a generic coding
    agent; locked decisions #4/#5 (no parallel model router / no second generic executor)
    and the single-tool-execution-loop boundary stand.
  - *No precedent*: any future proposal that (a) makes a MOS market-intelligence feature
    depend on Muse Code, (b) extends delegated execution beyond New Task sessions, or
    (c) adds another delegated-execution backend requires a new ACR with explicit review;
    this record cannot be cited as precedent for any of them.

No decision in the "Current locked decision" / "Proposed decision" sections above changes:
Muse Code remains a delegated execution backend (never a provider), the single
tool-execution-loop boundary stands (MOS never re-approves or re-executes the external
agent's tools), and the credentials red line is unchanged.

## Revision 3 (2026-11-15, PR #27 external verification round 2 — three code corrections)

External verification on the rev. 2 head confirmed CI green, the PR #28 reconciliation, the
54-test fresh-clone reproduction and the SDK typings check, and sent back three code issues
plus one product gap. All three corrections are delivered on PR #27 with regression tests;
the product gap is scoped as a separate work package (MC-D), deliberately not part of this
PR (mapping: verification item 1 → C1, item 2 → C2, item 3 → C3, item 4 → MC-D):

- **C1 — documented `--workspace` flag on the exec surface.** Meta's current configuration
  documentation lists `--workspace <path>` as a common flag for interactive and headless
  execution (alongside `--model` and `--contributor-mode on|off`). The rev. 2 evidence claim
  that the flag does not exist was wrong and is corrected in evidence §1. The exec surface
  now passes `--workspace <MOS workspaceRoot>` on every run (contract-tested: the policy
  root, not the cwd, is passed; the mock CLI enforces the documented call shape). Workspace
  policy on the exec surface = MOS lexical+physical containment (first gate) + the CLI's
  own `--workspace` boundary + Muse's sandbox.
- **C2 — exact lockstep version gate.** The official SDK README pairs SDK X.Y.Z with Muse
  Code X.Y.Z and instructs consumers to pin an exact version; the rev. 2 auto gate used
  `CLI ≥ pin`, which would drive the `1.4.20` SDK against a `1.4.21`/`1.5.0` CLI. The gate
  is now exact equality (`museCliVersionMatchesSdkPin`: bare x.y.z only — prerelease/build
  suffixes do not match); any deviation selects the exec fallback. Widening requires an
  official compatibility matrix and a new revision of this record. The explicit
  `executionSurface` setting remains the user's informed override for on-machine diagnosis.
- **C3 — stored workspace roots enforced on session resumption.** The durable map already
  stored `workspaceRoot`; it is now consulted: a resume (MSP `resumeSession` / exec
  `--session-id`) is attempted only when the stored root and the current request root are
  the same — lexically, or through realpath alias resolution, so symlinks/Windows junctions
  pointing at the same physical directory keep continuity while lexical comparisons can
  never bypass the workspace boundary (containment also gained the physical re-check). A
  different physical root refuses the resume: a fresh Muse session starts inside the current
  root (mapping self-heals on write) and the turn result, message metadata and log carry
  `sessionWorkspaceMismatch: true` — the continuity reset is attributable, never silent.
- **MC-D (scoped follow-up, separate PR) — explicit Muse model / Contributor-mode
  selection.** Today the Composer disables model selection while the backend is active with
  an explicit lock reason, and the execution request carries no model selection; Meta now
  documents `--model` and `--contributor-mode on|off` for headless CLI runs. MC-D will
  deliver the selection experience for New Task **and** Studio parity; for the MSP route it
  must first establish the officially supported way to select these options (SDK/protocol
  surface) — the `muse exec` flags must not be assumed to configure an MSP session. Not
  implemented in this PR.

No boundary changes: Muse Code remains a delegated execution backend (never a provider),
the single-tool-execution-loop and credentials red lines stand, and the Revision 2 roadmap
guardrail is unaffected.

## Revision 4 (2026-11-15, PR #27 external verification round 3 — three safety corrections)

The TL verification round on the rev. 3 head sent back three safety findings on the
resume/containment/startup machinery. All three corrections are delivered on PR #27 with
regression tests (mapping: finding A → resume gate, finding B → containment, finding C →
MSP startup):

- **A — workspace symlink retargeting closes the resume gate's lexical shortcut.** The rev. 3
  gate compared the stored root string against the current request root with a lexical
  equality shortcut before any physical resolution, so a mapping created through a symlink
  kept resuming the old Muse session after the symlink was **retargeted** to a different
  physical workspace (identical path strings, different physical roots). The durable mapping
  now persists a **canonical physical root** (`canonicalWorkspaceRoot`, realpath-resolved at
  mapping time; unresolvable-at-record → empty → resume refused), and every resume
  re-resolves the **current** request root physically and compares it against the stored
  canonical root — `canResumeMuseSessionMapping` has **no lexical same-string shortcut**
  (identical strings can hide a retarget). Legacy mappings without a canonical root are
  refused (fail-closed: fresh session inside the current root, `sessionWorkspaceMismatch`
  reported). Regression tests on **both** surfaces create a mapping through a symlink,
  retarget the symlink, and verify the old session is refused (MSP: no `resumeSession`,
  `sessionWorkspaceMismatch: true`; exec: no `--session-id` in argv, mismatch reported).
- **B — unresolvable workspace boundaries are rejected before spawn (no lexical fallback).**
  The rev. 3 containment check treated a **failed** physical containment check as a pass on
  the lexical verdict alone ("resolution unavailable → lexical fallback"). A boundary that
  cannot be physically resolved cannot be verified, and both official surfaces require an
  existing, resolvable root (MSP `session/start` `workspaceRoots` are "canonical existing
  directory paths"; exec `--workspace <root>` needs the directory to exist) — so **no narrow
  exception is justified**: ENOENT (missing cwd or root) and EACCES (inaccessible boundary)
  now reject with the distinct stable issue code `workspaceUnresolvable` before any spawn,
  with the failure visible to the user. Contract tests cover both arms on real filesystems
  (ENOENT) and via injected realpath failures (EACCES, deterministic under root-run CI).
- **C — a late-resolving MSP client is shut down; the startup phases are gated.** The rev. 3
  startup timeout raced `spawnClient` against a bare `Promise.race`: when the timeout fired
  first, a client that resolved **after** the timeout was never assigned and never closed —
  a leaked `muse serve` process tree. The SDK's `MuseClientSpawnOptions` has no `signal`
  member (verified against the installed `@muse-code/sdk@1.4.20` typings), so cancellable
  startup is not natively supported; the new `startupTimeoutGate` is the cancellation: on
  timeout it rejects visibly (same `spawnFailed` startup error, phase-named message) and
  **closes the late-resolving client** when it eventually resolves (SDK `close()` drains with
  the 5s bound and escalates to SIGTERM/SIGKILL — no process remains). The gate now also
  covers the **session-open phase** (`startSession`/`resumeSession`), which previously had
  no startup bound; on that phase's timeout the already-assigned client is closed by the
  outer `finally`. `startupTimeoutMs` is injectable for tests. Contract tests: a fake SDK
  client resolving after the timeout is closed (observed) and the run fails visibly; a
  hanging session open fails visibly with the client closed and no turn submitted.

No boundary changes: Muse Code remains a delegated execution backend (never a provider),
the single-tool-execution-loop and credentials red lines stand, and the Revision 2 roadmap
guardrail is unaffected. MC-D (explicit model selection) remains the separately-stacked
work package per Revision 3.

## Revision 5 (2026-11-15, MC-D — selection-driven delegated routing for the existing Contributor model)

External verification round 3 on the installed MOS RC3 (built from `3832d055`, **before** PR
#27) established: the Composer already carries a Muse Spark Contributor selection
(`meta/muse-spark-1.3-contributor`), its HTTP endpoint is **blocked by the account's
training-policy** ("0/1 endpoints eligible" — no successful inference), and seeing the model
in RC3 does not connect it to the delegated backend. The ordered work: trace the entry, make
the **existing** selection usable through the authenticated CLI subscription (no second
catalog entry, no OpenRouter, no separately billed API key, no privacy-setting changes),
cover New Task **and** Studio, and preserve the account's training-policy restrictions.

**Trace conclusion (evidence rev. 5 §1).** This repository's builtin catalog ships exactly
one Muse model — `muse-spark-1.2-contributor-free` under the `opencode-zen-chat` template
(OpenCode Zen, api-key, `https://opencode.ai/zen/v1`) — identical at RC3's commit
`3832d055`. `meta/muse-spark-1.3-contributor` is **not** in this repository's catalog at
either commit: it is a user-side provider configuration, and its endpoint eligibility is
governed by the account-policy layer **outside this repository** (no repo source contains
that wording). MOS leaves both the policy and the entry untouched.

**Discovery (MSP model surface, `@muse-code/sdk@1.4.20` typings).** The official MSP model
surface is `SessionStartParams.modelId` (initial model; server default when omitted),
`MuseClient.listModels` (`model/list` — the host's `ModelCatalogEntry` vocabulary), and
`Session.setModel` (`session/setModel` — durable per-session selection). There is **no
contributor-mode member** anywhere in the SDK. The exec surface documents `--model` and
`--contributor-mode on|off`. Consequence: MOS passes **no** model id or mode by default —
the delegated path runs under the CLI's own authenticated configuration (the user's
Contributor subscription sign-in), because the CLI-side model-id vocabulary is not
verifiable offline and inventing one would risk `invalidParams` rejections.

**Routing decision (MC-D).** A turn routes through the delegated backend when the envelope
carries `executionBackend: "muse-code"` (explicit, unchanged) **or** the turn's effective
model selection matches the shared Muse delegated model family
(`isMuseDelegatedModelSelection` — bare `muse-spark-<version>-contributor`; the OpenCode
Zen `-free` variant is deliberately excluded) **and** the Host setting `useAsTaskBackend`
is enabled (the CLI reads the same settings file the ports and Host service share;
tolerant read, default off = zero behavior change). The CLI-side rule is computed at v4
admission from `resolveSubmittedExecutionState` (payload selection ?? session standing
selection), so it covers **every** submission surface by construction — New Task Composer,
Studio mission-linked sessions, cold-resumed sessions — while the renderer's envelope
stamping applies the same family rule to the payload's selection (explicit wire intent,
old-CLI fail-safe unchanged).

**Semantic change of the toggle (recorded).** `useAsTaskBackend` previously meant "all New
Task turns delegate, model selector locked". Under MC-D it means "Muse delegated family
selections execute through the local CLI subscription; the selector stays genuinely
usable". The R6 lock-reason behavior is superseded: model selection is now the routing
input, the indicator shows active only when the current selection routes delegated, and
per-model honesty is preserved (ordinary selections run the ordinary path). No catalog
entry is added; no provider/endpoint configuration changes; no credential is read, copied
or created; the account's training-policy restrictions (and the blocked HTTP endpoint
failure) remain exactly as-is — the delegated path is the only compliant execution route
for the Contributor selection, using the CLI's own subscription sign-in.

Studio parity: Studio has no model picker of its own (its missions ride on zcode
sessions); the CLI-side selection-driven routing makes the Contributor selection work in
Studio-linked sessions by construction, and this is recorded as the Studio coverage
mechanism.

## Approval

- TL: payswapdotorg（TL-authored vertical slice; rev. 2–rev. 5 revisions TL-authored after external review/verification）
- Required domain/security reviewers: 待评审（rev. 4/rev. 5 修正后需在推送 head 上重新评审）
- Commit / PR that updates architecture lock and module registry: PR #27（policy admission：`muse-code-delegated-backend-unmanaged-edit`）；MC-D 随附 PR #30（stacked on #27，policy admission：`muse-code-selection-routing-unmanaged-edit`）

