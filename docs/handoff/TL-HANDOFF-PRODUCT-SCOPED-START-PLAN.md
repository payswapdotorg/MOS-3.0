# TL Handoff — MOS Product-Scoped Free Start Plan

**From:** Architect
**To:** TL (release engineering)
**Date:** 2026-11-14
**Priority:** P0 — blocks local-agent acceptance
**Status:** accepted for delivery (this document is the authoritative task spec)
**Repository:** `payswapdotorg/MOS-3.0`

## Objective

Give MOS its own legitimate free model allowance, separate from ZCode and other
applications built from the ZCode codebase, without requiring the user to purchase a
subscription or API credits.

## 1. Required product behavior

MOS must have its own product-scoped free Start Plan.

A user with the same authenticated account should be able to use:

- ZCode's own free Start Plan allocation.
- MOS's separate free Start Plan allocation.
- Future ZCode-derived products' independently configured allocations.

The allowances must not consume or overwrite one another.

**Important entitlement rule:** one grant per authenticated user per registered product,
not one grant per installation. Reinstalling MOS, changing devices, changing app
versions, or deleting local configuration must not create another MOS free trial.

This is a product entitlement separation requirement, not permission to repeatedly
reset or circumvent a provider's trial restrictions.

## 2. Findings from the existing MOS-3.0 source

### A. MOS already has a separate desktop identity

Source: `packages/desktop/scripts/desktop-product-identity.mjs`

The MOS identity is already defined:

- Flavor: `mos`
- App ID: `org.payswap.mos`
- Product name: `MOS`
- Separate executable and package names.
- Separate application data directory.

However, this is currently a desktop packaging identity. It does not automatically
establish a separate billing identity.

### B. The Start Plan client still uses shared ZCode billing endpoints

Source: `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts`

The existing implementation:

- Retrieves `startPlanPreview` from shared `client/configs`.
- Retrieves manual claimable plans from `/api/v1/zcode-plan/billing/preview`.
- Claims a plan through `/api/v1/zcode-plan/billing/claim`.
- Sends the user's ZCode JWT, ZCode application version and platform.
- Submits `{ plan_id }` as the claim body.

It does not currently submit an independent MOS product identifier.

The existing shared contract is in `packages/shared/src/coding-plan-subscription.ts`.
`StartPlanPreviewConfig` contains a plan ID, name and entitlements, but does not
identify which application owns the allocation.

### C. Balance and quota need the same separation

Source: `docs/model-provider-coding-plan-availability.md`

Start Plan balance requests use the shared ZCode billing endpoint. The device
identifier is also required by that endpoint.

Source: `docs/zcode-endpoint-device-mid-header.md`

Do not mistake `X-Device-Mid` for product identity. Device identity and product
identity are different concepts. We need a stable product scope that remains the same
across installations of that product.

### D. The existing provider registry already has Start Plan provider identities

Source: `packages/shared/src/model-provider-types.ts`

Existing identities include:

- `account:zai-start-plan`
- `account:bigmodel-start-plan`

Preserve the existing provider family and model-selection architecture. The new
product scope must determine which entitlement and quota are available to the current
application. Do not create a second model registry or executor inside MOS.

## 3. Required implementation

### W1 — Establish a shared runtime product identity

Extend the existing product identity mechanism so that application services can
resolve a stable, build-injected product identity.

| Application | Stable product ID | Desktop App ID |
|---|---|---|
| ZCode | `zcode` | `dev.zcode.app` |
| MOS | `mos` | `org.payswap.mos` |

Keep the API product ID separate from the reverse-domain desktop App ID.

Requirements:

- The product ID must be supplied by the trusted application build/runtime composition.
- It must be available to the Host services that call billing and entitlement APIs.
- Renderer forms, user preferences and arbitrary environment values must not be able
  to select another product's entitlement.
- Preserve ZCode's existing product identity as the default.
- Make registration of additional ZCode-derived products possible without rewriting
  the subscription service.

### W2 — Introduce product-scoped Start Plan configuration

The shared Start Plan preview must become product-aware.

The backend should be able to return a different Start Plan configuration for `zcode`
and `mos`.

For MOS, configure an independently identifiable free plan with its own entitlement
allocation and quotas.

The preview response should identify the product scope, plan identity and
entitlements. Do not infer that a MOS grant exists just because the ZCode preview
exists.

### W3 — Separate free-plan claim and grant records

Update the server-side claim flow to associate each free-plan allocation with:

`authenticated_user_id + registered_product_id + plan/grant identity`

For each product:

1. Check whether the authenticated user already has that product's free grant.
2. Return the existing grant when one exists.
3. Permit a first claim only when the registered product's free plan is available.
4. Make claim operations idempotent and concurrency-safe.
5. Record the grant and its quota independently.
6. Return the actual grant status, start/end times and entitlement details.

An account that already has a ZCode grant should still be eligible for the separately
configured MOS grant, subject to the registered product policy.

An account that already has a MOS grant must not get a fresh allowance merely by
reinstalling MOS.

Do not implement this by resetting the existing ZCode grant or changing its plan ID.

### W4 — Apply the product scope consistently to all usage paths

This is essential. Separating the claim alone is insufficient.

Propagate the same product identity through:

- Client configuration and Start Plan preview.
- Manual plan preview and claim.
- Start Plan balance.
- Quota and usage queries.
- Entitlement refresh and invalidation.
- Plan identity and provider availability.
- Cached entitlement/balance results.

The cache identity must include product scope, authenticated account and provider
family. A cached ZCode entitlement must never be returned as a MOS entitlement.

Usage debits must hit the correct product allocation. Consuming MOS quota must leave
the ZCode allocation unchanged, and vice versa.

### W5 — Backend ownership and security

The MOS-3.0 repository clearly contains the client-side billing integration. Locate
the actual server-side handlers for:

- `/api/v1/client/configs`
- `/api/v1/zcode-plan/billing/preview`
- `/api/v1/zcode-plan/billing/claim`
- `/api/v1/zcode-plan/billing/balance`
- Relevant quota and usage endpoints.

If these handlers live in another repository, create a paired backend implementation
handoff and coordinate both changes. Do not mark this complete after only adding a
client header.

The server must accept only registered product IDs and must enforce the user/product
entitlement boundary using authenticated server-side state. A freely editable
`X-Product-ID` header by itself is not sufficient authorization.

The plan grant must be auditable and resistant to duplicate claims and race
conditions.

## 4. Acceptance tests

Use the same authenticated test account and provider family for both applications.

| Test | Expected result |
|---|---|
| First ZCode activation | ZCode free grant is available |
| First MOS activation | A separate MOS grant is available |
| Read ZCode balance | Returns only ZCode allocation |
| Read MOS balance | Returns only MOS allocation |
| Consume MOS model quota | MOS quota decreases; ZCode quota is unchanged |
| Consume ZCode model quota | ZCode quota decreases; MOS quota is unchanged |
| Restart MOS | MOS entitlement remains available |
| Reinstall MOS | Existing MOS grant is recovered; no new trial |
| Restart/reinstall ZCode | Existing ZCode grant is preserved |
| Switch accounts | Entitlements and caches follow the authenticated account |
| Unknown product ID | Rejected or fail-closed |
| Backend unavailable | Show unknown/unavailable; do not manufacture a free entitlement |
| Concurrent claim attempts | At most one grant is created per user/product |

Cover both Z.AI and BigModel Start Plan paths where they remain supported. Do not
silently substitute one provider family's entitlement for another.

### Real desktop acceptance

Once the backend and client changes are deployed:

1. Build and install a new MOS RC.
2. Sign in using the existing supported account flow.
3. Open Model Providers and locate MOS's Start Plan.
4. Claim the MOS free plan if it is not already claimed.
5. Select a verified free model.
6. Run a normal New Task through Composer.
7. Verify actual model responses and tool execution.
8. Verify the session lifecycle and the MOS Studio mission linkage.
9. Inspect the quota before and after a real request.
10. Confirm that the existing ZCode installation and its entitlement remain untouched.

Save screenshots, sanitized API diagnostics, grant IDs and before/after quota
evidence. Never record JWTs, API keys or other secrets.

## 5. FreeLLMAPI fallback

Do not make FreeLLMAPI the primary solution until the existing Start Plan route has
been investigated and the backend owner has confirmed whether product-scoped grants
can be provided.

If the existing free plan cannot be made independently available to MOS, evaluate:

https://github.com/tashfeenahmed/freellmapi

The canonical FreeLLMAPI project provides an OpenAI-compatible gateway and
free-provider fallback routing. MOS should connect to it through ZCode's existing
custom OpenAI-compatible provider support, not through a new MOS model executor.

This fallback still requires a usable upstream free provider account/key or a provider
that permits keyless access; it is not unlimited free inference.

## 6. Required TL deliverables

1. Source audit identifying the exact client and server ownership of the existing
   Start Plan.
2. An ADR documenting product identity, grant ownership, quota separation and
   compatibility with existing ZCode users.
3. Implementation in MOS-3.0 and the required backend repository.
4. Tests proving two separate product allocations for the same authenticated user.
5. A new Windows x64 MOS release candidate.
6. A setup guide enabling the local agent to use the MOS free model without a paid
   subscription.
7. Evidence from the actual Windows desktop acceptance workflow.

Do not close this task on mocked API responses, local-only quota records, screenshots
of the plan card, or a successful model-list request. The proof must include a real
server-backed grant and a real model execution.

**Definition of done:** MOS can independently claim and consume its own authorized
free Start Plan allocation; ZCode's allocation remains separate; and the local Windows
agent can complete a real MOS acceptance workflow without purchasing a subscription
or topping up an API account.
