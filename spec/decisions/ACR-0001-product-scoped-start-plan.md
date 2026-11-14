# Architecture Change Record — ACR-0001

**Status:** accepted
**Owner:** TL (release engineering)
**Date:** 2026-11-14
**Related PR / issue:** `spec/backlog/product-scoped-start-plan.md`; handoff
`docs/handoff/TL-HANDOFF-PRODUCT-SCOPED-START-PLAN.md`; audit
`docs/handoff/START-PLAN-SOURCE-AUDIT.md`
**Affected modules/contracts:** `packages/shared` (env, coding-plan-subscription
contract, zcode-source-headers), `packages/services` (coding-plan-subscription,
model-provider billing/availability/auth, providers/api, usage-stats),
`packages/ui` (entitlement caches, Start Plan preview hook), model-plane
provider-runtime-headers flow. No new module; no provider-registry change.

## Context

MOS is a separately distributed product (own app id, data root, installers) built
from the ZCode codebase, but its free Start Plan (free model allowance) billing path
is identical to ZCode's: same endpoints, same claim body, caches with no product
dimension. As a result a MOS user would consume ZCode's free allocation, or see none.
The architect handoff (P0) requires a **product-scoped free Start Plan**: one grant
per authenticated user per registered product, independently configured, without
purchase.

The source audit (`docs/handoff/START-PLAN-SOURCE-AUDIT.md`) established the central
constraint: **all billing/entitlement endpoints are served by the external provider
(Z.AI/BigModel, `https://zcode.z.ai`)**. No server-side handler exists in any
repository we own. Grant records, one-per-user-per-product enforcement, and
product-scoped debits are therefore provider-side capabilities that this repository
can enable and consume, but not implement.

## Current locked decision

Decision lock §4 ("no parallel model router": model/provider invocation and user
selection remain in ZCode) and §8 ("no provider calls from domain modules"; network
interaction goes through approved paths) govern this area. Upstream behavior today:
Start Plan preview/claim/balance requests carry user (JWT), device
(`X-Device-Mid`), app version and platform — **no product scope anywhere** — and the
`zcode` product is the implicit only product.

## Proposed decision

**Rule P1 — Stable API product identity.** A registered product id set
(`zcode`, `mos`) is defined in `packages/shared/src/env.ts`, derived exclusively from
the build-injected product flavor (`__ZCODE_PRODUCT_FLAVOR__`; `mos` flavor → `mos`,
everything else → `zcode`). The API product id is deliberately distinct from the
reverse-domain desktop App ID (`org.payswap.mos`) and from device identity
(`X-Device-Mid`). Renderer forms, user preferences and runtime env values cannot
select it; only the trusted build composition can. Adding a future product =
registering an id + a flavor mapping, without rewriting the subscription service.

**Rule P2 — Product scope on the wire.** All requests to the ZCode endpoint origin
carry `X-ZCode-Product-Id: <registered id>` via the shared source-header builder
(`buildZCodeSourceHeadersFromContext`), which covers `client/configs`,
`billing/preview`, `billing/claim`, `billing/balance` and the model-plane gateways
(usage debits) through the provider-runtime-headers start-plan auth material.
Claim bodies carry `product_id` **only for non-default products** (`mos`), keeping
`zcode` requests byte-identical to today (zero regression risk for existing ZCode
users; migration semantics for the server: absent `product_id` ⇒ `zcode`).

**Rule P3 — Response ownership, fail-closed.** Preview, claimable-plan and balance
records may declare an owning product (`productId` / `product_id`). Acceptance rule
(one helper, shared): a record is consumable iff its declared product equals the
current product id; **absent declaration is acceptable only to the default `zcode`
product**. Therefore, on the current (unscoped) production backend, MOS resolves no
Start Plan preview, no claimable plans, no active plan and no entitlement —
`coding_plan_not_entitled`/`no_plan` semantics, no manufactured entitlement, and no
consumption of ZCode's allocation. Unknown/foreign product ids are rejected for every
product.

**Rule P4 — Cache identity includes product.** Client-config snapshot, balance
in-flight, renderer localStorage entitlement and renderer Start Plan preview caches
all include the product id in their keys (alongside account/provider dimensions they
already carry). A cached `zcode` entitlement can never be returned as a `mos`
entitlement and vice versa.

**Rule P5 — Grant ownership is server-side.** One grant per authenticated user per
registered product, idempotent and concurrency-safe claims, product-scoped debits
and quotas are **provider-backend responsibilities** specified in the paired backend
handoff (`docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md`). The client
never persists grants locally (already true: entitlements are re-derived from
`billing/balance`), so reinstalling MOS cannot mint a new trial. This repository must
not represent W2/W3/W5 as complete on client evidence alone.

**Alternatives rejected:**
- *Self-hosted MOS billing backend*: would manufacture an entitlement we do not own
  and cannot back with real model access (handoff: "do not manufacture a free
  entitlement"); rejected.
- *Reusing `X-Device-Mid` as product scope*: device identity ≠ product identity
  (handoff §2C); rejected.
- *Second provider registry/model executor for MOS*: violates lock §4; the existing
  `account:zai-start-plan`/`account:bigmodel-start-plan` families are preserved and
  the product scope only selects which entitlement they see; rejected.
- *FreeLLMAPI as primary*: handoff §5 forbids promoting it before the Start Plan
  route is investigated and the backend owner has confirmed; it is a fallback
  through the existing custom OpenAI-compatible provider support.

## Impact analysis

- **ZCode preservation / existing feature impact:** default product `zcode` sends
  byte-identical claim bodies and accepts unscoped responses exactly as before; the
  only wire change for `zcode` is one additional request header the current server
  ignores. Existing ZCode users' grants, caches and flows are untouched.
- **New Task / Composer / shell impact:** none. No UI flow changes; the Start Plan
  card/claim UI automatically hides for MOS when no owned preview exists.
- **Runtime, permission, plugin, model or workflow authority:** unchanged (lock §2,
  §4 preserved; no new registry or executor).
- **Domain module authority and dependency graph:** no domain module touches the
  billing path (lock §8); changes live in shared/services/ui client layers only.
- **Data model, migration and historical compatibility:** no schema change; renderer
  entitlement cache key gains a product segment (old keys simply expire by TTL);
  server-side migration is specified in the backend handoff.
- **Provider API, credential and tenant/privacy impact:** requests gain one header
  (`X-ZCode-Product-Id`) and, for `mos` only, one claim body field (`product_id`);
  JWT/credential handling unchanged; no new personal data transmitted.
- **Security, trust and sandbox impact:** the product id is scope selection, never
  authorization (server enforces the boundary from authenticated state per handoff
  W5); fail-closed rules prevent cross-product entitlement leakage; unknown product
  ids rejected.
- **Cost, latency, quotas and operational impact:** one extra header; no extra
  requests. Server-side per-product quotas are a provider concern (handoff doc).
- **Web, desktop and remote client impact:** web/CLI builds resolve `zcode`
  (no flavor define) — unchanged behavior; MOS desktop (main + renderer, flavor
  `mos`) resolves `mos` everywhere including the model-plane runtime headers
  resolved Host-side.

## Implementation and migration

1. `packages/shared/src/env.ts`: `ZCodeProductId`, `isRegisteredZCodeProductId`,
   `resolveZCodeProductId`, `ZCODE_PRODUCT_ID`, `ZCODE_PRODUCT_ID_HTTP_HEADER`.
2. `packages/shared/src/coding-plan-subscription.ts`: optional `productId` /
   `product_id` on `StartPlanPreviewConfig`, `ManualClaimPlanPreview`,
   `ManualClaimPlanClaimResult.plan`; shared ownership helper
   `isStartPlanRecordOwnedByCurrentProduct`.
3. `packages/shared/src/zcode-source-headers.ts` (+ services `sourceHeaders.ts`,
   `nodeApiClient.ts`): product id header emission; `NodeApiClient` gains an optional
   `resolveProductId` (test seam; default is the build constant).
4. `bigmodelCodingPlanSubscriptionProvider.ts`: product-scoped client-config cache
   key; preview/claimable-plan ownership filtering; claim body `product_id` for
   non-default products; claim-result ownership validation; optional
   `resolveProductId` seam.
5. `zaiStartPlanBilling.ts`: `product_id` on balance plans; product-scoped request
   key; envelope filtered by record ownership before any consumer (availability,
   quota snapshot) sees it; optional per-call product override (test seam).
6. `accountProviderRequestAuthService.ts`: start-plan request material carries the
   product header (model-plane debits scoped by product).
7. Renderer: `usageEntitlementCache` + `startPlanEntitlementOptions` product-scoped
   cache key; `useStartPlanPreview` cache keyed by service + product.
8. Contract tests (`packages/desktop/test/codingPlanProductScope.test.ts`, registered
   in `scripts/engineering-test-files.json`) run a real local product-aware mock
   backend through `NodeApiClient` covering the client-provable acceptance matrix.
9. Backend handoff delivered to the provider; FreeLLMAPI fallback documented in the
   setup guide (`docs/release/FREE-MODEL-SETUP.md`), never wired as a second
   executor.

Rollout is inherently staged: client support ships first (harmless to the current
backend — MOS simply reports the Start Plan as unavailable), the provider implements
the backend contract, then MOS's Start Plan becomes claimable with no further client
change.

## Tests and evidence

- Engineering contract tests: product ownership matrix (both products ×
  scoped/unscoped/foreign/unknown responses), claim body/headers per product, balance
  filtering, cache-key separation (same URL+JWT, different product ⇒ independent
  entries), fail-closed rows (unknown product id, backend unavailable semantics),
  idempotent re-claim presentation, product header on all endpoint requests and on
  start-plan request-auth material.
- Existing gates: lint, docs stale-phrase, architecture check, engineering
  affected tests, desktop identity tests (flavor → product id derivation).
- Real two-allocation proof (same account, ZCode + MOS grants, quota cross-isolation,
  reinstall/restart, concurrent claims) requires the provider backend per the handoff
  acceptance table; recorded as provider-pending, per lock §14/§15 (mocks prove
  contracts only; unknown stays unknown).

## Rollback

The product id defaults to `zcode` everywhere a flavor define is absent, so
reverting the MOS build's flavor injection (or the whole change set) restores
today's single-product behavior without data migration; cached renderer entries
self-expire (10-minute TTL). No user data is lost; no server-side migration is
required from the client side. Fail-closed semantics mean disabling the feature
never leaks a cross-product entitlement.

## Approval

- TL: accepted (this record).
- Required domain/security reviewers: architect handoff (P0 directive) satisfied the
  product/security review; provider backend review is owned by the provider per the
  backend handoff.
- Commit / PR that updates architecture lock and module registry: none required (no
  locked-decision text change, no new module; lock §4/§8 compliance preserved — this
  ACR is the recorded interpretation).
