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
| **B. Custom OpenAI-compatible provider** (interim fallback) | ZCode's standard custom-provider path pointed at a free model source — directly at OpenRouter's `:free` models (B1) or at a self-hosted FreeLLMAPI gateway aggregating provider free tiers (B2) | **Verified end-to-end 2026-11-14** (real completions + real tool calls through both paths; details below). **Does not count as Start Plan acceptance evidence.** |

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
   - Before the backend ships, MOS shows **"the billing provider hasn't enabled a
     Start Plan for this product yet"** (not a used-up trial). Stop here; Route A
     is not yet available, and you must not treat ZCode's Start Plan card in the
     ZCode app as MOS evidence.
   - After the backend ships, an already-running MOS picks the plan up within
     ~5 minutes automatically, or immediately via the **Refresh** button on the
     Start Plan status card (Issue #23 fix; no reinstall/restart needed).
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
substitute for Route A acceptance evidence. Both sub-routes below were verified
end-to-end on 2026-11-14 from the release-engineering sandbox: real chat completions
**and** real tool calls (`get_weather({city:"Accra"})` → `finish_reason=tool_calls`),
all at $0 cost. Verification record: `docs/handoff/IMPLEMENTATION-STATE.md` (Route B
verification, 2026-11-14).

Caveats (from the architect handoff §5 — do not paper over these):

- Free model variants are **shared free pools**: individual variants get upstream 429s
  under load (observed: `google/gemma-4-26b-a4b-it:free` rate-limited upstream while
  five other variants responded). Retry, or select another verified variant.
- A free-tier OpenRouter key without purchased credits is request-limited per day;
  verification-sized smoke runs fit comfortably, sustained agent work may not.
- The FreeLLMAPI gateway is BYO-keys: it routes each model only to provider platforms
  you hold a key for (observed: unified id `nemotron-3-ultra` unusable without an
  NVIDIA key, while OpenRouter-backed ids worked). It aggregates free tiers — it is
  **not** unlimited free inference.
- Verify the gateway project, its license (MIT) and its current routing behavior at
  setup time; do not treat it as a trusted party for anything beyond the models it
  serves. Respect the upstream providers' terms; this route must not be used to
  circumvent any provider's trial restrictions.
- **Never put API keys in repo files, screenshots or evidence records.** The org
  OpenRouter key lives in the `ops-vault` repository (`credentials.env`,
  `OPENROUTER_API_KEY`); fetch it from there at setup time.

### B1 — direct OpenRouter custom provider (simplest; verified)

OpenRouter serves a rotating set of `:free` model variants on its standard
OpenAI-compatible API using the org's existing key.

1. Fetch the org OpenRouter key from `ops-vault` (`credentials.env`,
   `OPENROUTER_API_KEY`).
2. In MOS: **Settings → Model Providers → Add provider → Create custom provider**, API
   format **OpenAI Compatible**, base URL `https://openrouter.ai/api/v1`, paste the key.
3. Add/select one of the models verified on 2026-11-14 (re-check
   `GET https://openrouter.ai/api/v1/models` for the current `:free` list — variants
   rotate):
   - `nvidia/nemotron-3-ultra-550b-a55b:free` — 550B MoE, 1M ctx, **tool calls
     verified**
   - `cohere/north-mini-code:free` — code model, **tool calls verified**
   - `inclusionai/ling-3.2-flash:free` — fast, 1M ctx, **tool calls verified**
   - `nvidia/nemotron-3.5-lightning:free`, `liquid/lfm-3-1.7b:free`,
     `baidu/ernie-5.5-flash-preview:free` — completions verified
4. Run a small **New Task** through Composer; confirm responses and tool execution
   before relying on it.

### B2 — FreeLLMAPI gateway (multi-provider free pool with failover; verified)

[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) (MIT) aggregates the free
tiers of 80+ providers behind one OpenAI-compatible `/v1` endpoint, with automatic
failover across models/keys. On Windows, install the desktop build
(`FreeLLMAPI-Setup-<ver>.exe` from its GitHub Releases; v0.16.29 verified published),
open the dashboard at `http://localhost:3001`, add provider keys on the **Keys** page
(any free-tier keys you legitimately hold — e.g. self-serve Google AI Studio / Groq /
Cerebras / Mistral keys; the org OpenRouter key also works), and copy the **unified API
key** from the Keys page header.

Headless/server installs: declarative startup config via `FREEAPI_CONFIG_PATH`
(admin account + `keys[]` entries; verified applying the OpenRouter key on boot).

Then in MOS (same custom-provider steps as B1): base URL
`http://localhost:3001/v1`, key = the unified key. Select a model from the gateway's
catalog (`GET /v1/models`; 330 served in verification) or use `auto` routing (verified
picking working free models automatically). Note the BYO-keys caveat above: unified
model ids route only to platforms you have keys for.

## What closes the Start Plan task (for the TL record)

Only Route A evidence closes it: a **real server-backed MOS grant** plus a **real model
execution on the MOS free allocation**, with ZCode's allocation proven separate
(handoff §6: mocked responses, local-only quota records, plan-card screenshots or a
model-list request do not count). Until the provider backend ships, the honest state is
"client ready, backend pending" — recorded in `docs/handoff/IMPLEMENTATION-STATE.md`.
