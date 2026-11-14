# Start Plan Product Scope — Backend Implementation Handoff

**Audience:** Provider backend owners (Z.AI / BigModel — the service behind
`https://zcode.z.ai/api/v1/client/configs` and `/api/v1/zcode-plan/billing/**`)
**From:** MOS (payswapdotorg) release engineering
**Date:** 2026-11-14
**Task:** `spec/backlog/product-scoped-start-plan.md` · ACR:
`spec/decisions/ACR-0001-product-scoped-start-plan.md` · client audit:
`docs/handoff/START-PLAN-SOURCE-AUDIT.md`
**Client status:** the MOS-3.0 client (this repository) already implements the full
protocol below and fail-closes until the backend serves it.

## Why this is needed

MOS is a separately distributed product built from the ZCode codebase (own app id
`org.payswap.mos`, own data root, own installers). Today the free Start Plan is keyed
only by authenticated user, so MOS and ZCode would share one free allocation. The
product requirement (architect handoff, P0) is **one grant per authenticated user per
registered product**: the same account may hold both ZCode's and MOS's independently
configured free allowances, and neither may consume the other. Reinstalling MOS,
changing devices, or changing app versions must not mint a new MOS grant.

## Scope of this handoff

Server-side changes for: `client/configs`, `zcode-plan/billing/preview`,
`zcode-plan/billing/claim`, `zcode-plan/billing/balance`, and the model-plane
gateways `/api/v1/zcode-plan` (OpenAI-compatible) and
`/api/v1/zcode-plan/anthropic` (debits). The client side is complete and merged in
MOS-3.0 (ACR-0001); **this repository cannot and must not claim W2/W3/W5 done until
this backend contract ships.**

## Protocol contract

### Registered product catalog

- Registered product ids (initial): `zcode`, `mos`. Future ZCode-derived products
  register additional ids; the catalog is server-owned.
- Transport: request header `X-ZCode-Product-Id: <id>` on every endpoint listed
  above; the claim endpoint additionally accepts `product_id` in the JSON body.
- **Migration default:** absent header/body product scope ⇒ `zcode` (existing
  clients unchanged). This is the single most important compatibility rule.
- Unknown/unregistered product id ⇒ `400` (fail-closed). A product id is **scope
  selection, not authorization**: the server must resolve the entitlement boundary
  from authenticated state (JWT), never from the header alone (handoff W5).
- If both header and body product id are present and differ ⇒ `400`.

### 1. `GET /api/v1/client/configs`

- Response `startPlanPreview` gains `productId: string` — the product scope this
  preview belongs to. Serve a different Start Plan configuration per registered
  product (independently configurable plan id, entitlements and quotas).
- When the requesting product has no free plan configured, return
  `startPlanPreview: null` (the client hides the free-plan card — never substitute
  another product's preview).
- Legacy `zcode` responses may omit `productId` (the client treats unscoped as
  zcode-owned). New `mos` responses **must** include it.

### 2. `GET /api/v1/zcode-plan/billing/preview`

- Each entry in `data.plans[]` gains `product_id: string`.
- Return only plans owned by the requesting product (a MOS client must not be
  offered ZCode's claimable plans, and vice versa).

### 3. `POST /api/v1/zcode-plan/billing/claim`

- Body: `{ plan_id, product_id? }` (`product_id` absent ⇒ `zcode`).
- Grant identity: **`authenticated_user_id + registered_product_id + plan_id`**.
- Behavior, in order:
  1. Validate product id is registered and `plan_id` belongs to that product.
  2. If the user already holds that product's grant for the plan ⇒ **return the
     existing grant** (same response shape, idempotent; never mint a second grant,
     never reset the window).
  3. Otherwise, if the product's free plan is currently available to this user
     (first claim) ⇒ create the grant with server-side start/end times.
  4. Refuse when the product policy disallows a new grant (per-product eligibility,
     campaign windows, abuse limits).
- **Concurrency safety:** at most one grant per (user, product, plan) under
  concurrent claims — enforce with a unique constraint plus transactional insert
  (`INSERT ... ON CONFLICT DO NOTHING` then re-select) or an equivalent advisory
  lock; the loser of the race receives the winner's grant (idempotent response).
- Response `data.plan` gains `product_id: string`; include `user_plan_id`,
  `status`, `starts_at`, `ends_at`, `entitlements` as today.
- Audit log per claim attempt: user id, product id, plan id, outcome (created /
  existing / refused + reason), timestamp, device mid, IP. Retention per policy.

### 4. `GET /api/v1/zcode-plan/billing/balance`

- Scoped by the requesting product: return **only** that product's plans and
  balance buckets. Each `plans[]` entry gains `product_id: string`.
- A MOS balance read must never include ZCode allocations and vice versa (the
  client also fail-closes on foreign records, but the server is the authority).
- `X-Device-Mid` requirements remain unchanged.

### 5. Model-plane gateways (usage debits)

- `/api/v1/zcode-plan` and `/api/v1/zcode-plan/anthropic` accept
  `X-ZCode-Product-Id` and **debit the (user, product) allocation** matching the
  authenticated user + header product (absent ⇒ `zcode`).
- Quota enforcement, rate limits and business error codes apply per product
  allocation: consuming MOS quota must leave the ZCode allocation unchanged, and
  vice versa. Model capability whitelists may differ per product configuration.

## Data model sketch

- `user_plan` (grant record): add `product_id` (default `'zcode'`; backfill existing
  rows), unique index on `(user_id, product_id, plan_id)` where status is an active
  free-grant state (or a partial unique index appropriate to the plan lifecycle).
- Quota/usage buckets hang off `user_plan` as today — product separation follows
  from the grant key.
- Free-plan configuration becomes per-product (plan catalog entries owned by a
  product).

## Rollout order (server)

1. Tolerate the header everywhere (ignore unknown header on old code — already
   true) and register the product catalog.
2. Backfill `product_id='zcode'` on existing grants; keep absent-scope ⇒ `zcode`.
3. Ship claim/balance/debit scoping behind the catalog (zcode behavior identical).
4. Configure the MOS free plan (plan id, entitlements, quotas, eligibility) and
   announce availability.

Existing ZCode clients are byte-compatible at every step (they send the header with
value `zcode` or, for the claim body, omit `product_id` — both map to today's
behavior).

## Backend acceptance (mirrors the handoff matrix)

Same authenticated test account on both applications; both provider families where
supported (Z.AI and BigModel Start Plan paths stay distinct — never substitute one
family's entitlement for another):

| # | Test | Expected |
|---|---|---|
| 1 | First ZCode activation | ZCode free grant available |
| 2 | First MOS activation | Separate MOS grant available |
| 3 | Read ZCode balance | Only ZCode allocation returned |
| 4 | Read MOS balance | Only MOS allocation returned |
| 5 | Consume MOS model quota | MOS quota decreases; ZCode unchanged |
| 6 | Consume ZCode model quota | ZCode quota decreases; MOS unchanged |
| 7 | Reinstall MOS / new device | Existing MOS grant recovered; no new trial |
| 8 | Restart/reinstall ZCode | Existing ZCode grant preserved |
| 9 | Unknown product id (header/body) | Rejected (4xx), fail-closed |
| 10 | Concurrent claim attempts (N parallel) | Exactly one grant created; all receive it |
| 11 | Repeat claim after grant exists | Idempotent: existing grant returned |
| 12 | Account switch | Entitlements follow the authenticated account |
| 13 | Legacy zcode client (no header/no body field) | Identical behavior to today |

## Client evidence already in place

- Contract tests `packages/desktop/test/codingPlanProductScope.test.ts` (product
  matrix, claim body/headers, balance filtering, cache separation, fail-closed).
- Client fail-closed rules mean **no MOS entitlement is shown or consumed until
  this backend contract is live** — no risk to ZCode users in the interim.

## Coordination

MOS-3.0 (payswapdotorg) owns the client; the provider owns this server surface.
Once the backend ships, MOS's real-desktop acceptance (sign-in → claim MOS plan →
real model execution → quota before/after → ZCode untouched) runs against it with
no further client change; evidence will be recorded in
`docs/handoff/IMPLEMENTATION-STATE.md`.
