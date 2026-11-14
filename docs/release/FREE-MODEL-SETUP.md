# MOS Free Model Setup Guide (for the local agent)

**Audience:** the local AI agent performing MOS acceptance on a Windows x64 machine.
**Goal:** use a free model in MOS without purchasing a subscription or topping up an API
account.
**First RC with product-scoped Start Plan support:** `mos-v3.0.0-rc.2` (see
`docs/release/CONSUMER-CONTRACT.md` for download → SHA-256 verify → install → launch).

## Current status — read this first

There are two routes. They are **not** interchangeable:

| Route | What it is | Status |
|---|---|---|
| **A. MOS free Start Plan** (primary) | MOS's own authorized free allocation, separately granted from ZCode's, per account per product | **Client: shipped (rc.2). Backend: pending provider.** Until the provider implements `docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md`, MOS intentionally shows the Start Plan as **unavailable** — it does not consume or display ZCode's allocation. This is fail-closed by design, not a bug. |
| **B. Custom OpenAI-compatible provider** (interim fallback) | ZCode's standard custom-provider path pointed at a free-provider gateway (e.g. FreeLLMAPI) | Usable today, subject to the fallback caveats below. **Does not count as Start Plan acceptance evidence.** |

The architect handoff (§5) permits evaluating the fallback only after the Start Plan
route has been investigated and its backend ownership confirmed — that investigation is
complete (`docs/handoff/START-PLAN-SOURCE-AUDIT.md`: the billing endpoints are owned by
the external provider; the paired backend handoff has been delivered). The fallback is
therefore documented below as the interim route, without replacing Route A.

## Route A — MOS free Start Plan (once the provider backend ships)

No new MOS build is needed after the backend ships; the rc.2+ client already speaks the
product-scoped protocol (`X-ZCode-Product-Id`, claim `product_id`, product-owned
previews/balances — see `docs/start-plan-product-scope.md` and
`docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md`).

Checklist (mirror of the handoff §4 real-desktop acceptance):

1. Install/launch the latest MOS RC (keep an existing ZCode installation untouched).
2. Sign in with the supported account flow (Model Providers → sign in).
3. Open **Model Providers** → the Start Plan card for MOS is present and claimable.
   - Before the backend ships it is absent/unavailable — stop here; Route A is not yet
     available, and you must not treat ZCode's Start Plan card in the ZCode app as MOS
     evidence.
4. Claim the MOS free plan (first claim for this account+product; reinstalling later
   must NOT offer a second trial).
5. Select a verified free model from the MOS Start Plan provider
   (`account:zai-start-plan` / `account:bigmodel-start-plan` family, model whitelist
   from the MOS balance).
6. Run a normal **New Task** through Composer; verify real model responses and tool
   execution.
7. Verify the session lifecycle and the MOS Studio mission linkage.
8. Inspect quota before and after a real request; MOS quota decreases, the ZCode
   installation's quota is unchanged (and vice versa when consuming in ZCode).
9. Evidence to save: screenshots, sanitized API diagnostics, grant IDs
   (`user_plan_id`), before/after quota numbers, and the same checks for ZCode's own
   allocation. **Never record JWTs, API keys or other secrets.**

## Route B — interim fallback via a custom OpenAI-compatible provider

This is ZCode's standard custom-provider mechanism (no second model executor, per the
architecture lock); it is usable today but is **not** the MOS free Start Plan and cannot
substitute for Route A acceptance evidence.

Caveats (from the architect handoff §5 — do not paper over these):

- A gateway such as [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) provides
  an OpenAI-compatible endpoint with free-provider fallback routing, but it still needs
  a usable upstream free provider (an account/key you are allowed to use, or a provider
  that permits keyless access). It is **not** unlimited free inference.
- Verify the gateway project, its license and its current routing behavior at setup
  time; do not treat it as a trusted party for anything beyond the models it serves.
- Respect the upstream providers' terms; this route must not be used to circumvent any
  provider's trial restrictions.

Steps:

1. Set up the gateway (self-host the FreeLLMAPI service, or use any endpoint you are
   authorized to use) and confirm which model ids it serves and what upstream
   credential it requires.
2. In MOS: **Model Providers → Add provider → OpenAI-compatible**, set the base URL to
   the gateway's OpenAI-compatible endpoint and supply the key it requires (if any).
3. Select one of its served models, run a small **New Task**, and confirm responses and
   tool execution before relying on it.
4. Record what you used (gateway, base URL host, model id, upstream provider type) —
   without any secrets.

## What closes the Start Plan task (for the TL record)

Only Route A evidence closes it: a **real server-backed MOS grant** plus a **real model
execution on the MOS free allocation**, with ZCode's allocation proven separate
(handoff §6: mocked responses, local-only quota records, plan-card screenshots or a
model-list request do not count). Until the provider backend ships, the honest state is
"client ready, backend pending" — recorded in `docs/handoff/IMPLEMENTATION-STATE.md`.
