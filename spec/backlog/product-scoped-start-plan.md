# Backlog — MOS Product-Scoped Free Start Plan

**Priority:** P0 (blocks local-agent acceptance)
**Handoff:** `docs/handoff/TL-HANDOFF-PRODUCT-SCOPED-START-PLAN.md`
**ACR:** `spec/decisions/ACR-0001-product-scoped-start-plan.md`
**Status:** in delivery

## Problem

MOS is a separately distributed product built from the ZCode codebase, but the Start
Plan (free model allowance) billing/entitlement path is shared with ZCode: the same
endpoints, the same claim body, and caches that do not carry a product dimension. A
MOS user today would either consume ZCode's free allocation or see none at all. MOS
needs its own legitimate, separately granted free allowance, keyed per authenticated
user per registered product — not per installation.

## Scope

- **W1** Shared runtime product identity: stable API product ID (`zcode` default,
  `mos` for MOS builds), derived from the build-injected product flavor, available to
  Host services; not selectable by renderer forms, user preferences or arbitrary env.
- **W2** Product-scoped Start Plan configuration: preview surfaces must identify the
  owning product; a MOS grant is never inferred from a ZCode preview.
- **W3** Separate free-plan claim/grant records: grants keyed by
  `authenticated_user_id + registered_product_id + plan identity`; idempotent,
  concurrency-safe claims (server-side; see backend handoff).
- **W4** Product scope on all usage paths: client config, manual preview, claim,
  balance, quota/usage, entitlement refresh/invalidation, provider availability, and
  every entitlement/balance cache key (product + account + provider family).
- **W5** Backend ownership: the billing endpoints are served by the external provider
  (Z.AI/BigModel), not by this repository. Deliverable is a paired backend
  implementation handoff (`docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md`)
  plus the full client-side protocol support; the server side is provider-owned and
  must not be claimed as done by this repo alone.

## Constraints

- Preserve ZCode's existing behavior as the default (zero request-shape changes for
  the `zcode` product against the current backend).
- Fail-closed: unknown or unowned product scopes never surface an entitlement; a
  legacy (unscoped) backend response is only acceptable to the default `zcode`
  product.
- One grant per user per product; no trial resets; no provider-policy circumvention.
- Provider family / model-selection architecture unchanged (`account:zai-start-plan`,
  `account:bigmodel-start-plan` remain the only Start Plan providers).
- FreeLLMAPI is a fallback route only, through the existing custom
  OpenAI-compatible provider support; never a second model executor.

## Evidence plan

- Engineering contract tests (product-scope matrix, cache separation, header
  propagation, fail-closed) — `packages/desktop/test/codingPlanProductScope.test.ts`.
- Real two-allocation proof requires the provider backend to implement the handoff
  contract; client evidence alone must not close W3/W5.
- Real desktop acceptance (sign-in, claim, real model execution, quota before/after)
  on the new RC once the backend route is available; setup guide for the local agent
  at `docs/release/FREE-MODEL-SETUP.md`.

## Deliverables

1. Source audit: `docs/handoff/START-PLAN-SOURCE-AUDIT.md`
2. ACR: `spec/decisions/ACR-0001-product-scoped-start-plan.md`
3. Client implementation (this repo) + backend handoff (provider repo)
4. Contract tests proving separate product allocations for one account
5. Windows x64 MOS release candidate (`mos-v3.0.0-rc.2`)
6. Setup guide: `docs/release/FREE-MODEL-SETUP.md`
7. Honest evidence record in `docs/handoff/IMPLEMENTATION-STATE.md`
