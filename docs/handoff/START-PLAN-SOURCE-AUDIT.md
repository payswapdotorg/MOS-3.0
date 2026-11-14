# Start Plan Source Audit — Client/Server Ownership

**Date:** 2026-11-14
**Task:** `spec/backlog/product-scoped-start-plan.md` (deliverable 1)
**Method:** full-repo endpoint sweep + server-side implementation search + request-path
trace (files referenced with `path:line` as of `a2fba802`).

## Verdict

**The MOS-3.0 repository owns zero server-side billing/entitlement handlers.** Every
Start Plan / coding-plan billing call in this repository is a *client* request against
the external ZCode origin `https://zcode.z.ai` (business-plane hosts
`https://bigmodel.cn` and `https://api.z.ai`). The server side of
`/api/v1/client/configs` and `/api/v1/zcode-plan/billing/**` is owned by the upstream
provider (Z.AI / BigModel) and is not present in any payswapdotorg repository we
control.

Consequence (per handoff W5): MOS-3.0 can deliver the **client protocol** and must
ship a **paired backend implementation handoff** for the provider. Adding a client
header alone cannot close W2/W3/W5.

## 1. Client request-construction sites (this repo)

| Endpoint | Construction site | Notes |
|---|---|---|
| `/api/v1/client/configs` | `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts:838-876` (`getClientConfigs`) | GET + `app_version` + `platform`, optional `Authorization: Bearer <zcodejwttoken>`; 60-min in-memory snapshot; `startPlanPreview` unwrapped at `:1455-1477`. Also generic client at `packages/services/src/client-config/clientConfigService.ts:79-84`. |
| `/api/v1/zcode-plan/billing/preview` | `bigmodelCodingPlanSubscriptionProvider.ts:280-338` (`getManualClaimPlanPreviews`) | GET + `app_version` + `platform`, optional Bearer JWT; not cached. |
| `/api/v1/zcode-plan/billing/claim` | `bigmodelCodingPlanSubscriptionProvider.ts:340-411` (`claimManualPlan`) | POST body `{ plan_id }`; headers: Bearer JWT, request-verification proof, `X-ZCode-App-Version`, `X-Platform`. UI caller `packages/ui/src/components/marketing-touch/MarketingTouchProvider.tsx:249-300`. |
| `/api/v1/zcode-plan/billing/balance` | `packages/services/src/model-provider/zaiStartPlanBilling.ts:63-127` (`fetchZaiStartPlanBalanceEnvelope`) | GET + `app_version`; Bearer JWT; ~1 s in-flight dedupe. Consumers: availability `packages/services/src/model-provider/codingPlanProviderAvailability.ts:406-447` and quota snapshot `packages/services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts:377-477`. |
| Model plane (usage debits) | `config/provider/zcode-builtin.json:1108,1171` — Start Plan providers use `https://zcode.z.ai/api/v1/zcode-plan/anthropic` | Runtime auth per request via `packages/services/src/model-provider/accountProviderRequestAuthService.ts:86-89` (apiKey = ZCode JWT) delivered to the agent process through the provider-runtime-headers port (`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/provider-runtime-headers.ts`; Host responder `packages/services/src/zcode-agent/zcodeAgentService.ts:6497-6576`). |

Other `zcode-plan` endpoints: `packages/shared/src/zcodeEndpoint.ts:381-384`
(`zcodePlanOpenAiBaseUrl`, `zcodePlanAnthropicBaseUrl`, deprecated `billing/current`,
`zcodePlanBillingBalanceUrl`).

## 2. Server-side search result

Only three HTTP servers exist in the repo, none billing:

- `packages/server/src/http.ts` (Hono) — `/api/server-info`, `/ws/host`, static.
- `packages/zcode-server-cli/src/server-core/http.ts` — `/api/server-info`,
  `/api/rpc-host-capability`.
- `apps/zcode-cli/packages/debug/server/index.ts` — debug-only traces.

The only in-repo implementations of the billing routes are **test doubles**
(`packages/desktop/test/e2e/helpers/coding-plan-upgrade-mock-server.ts:412,449,525,532`
and other e2e fixtures). No production handler exists anywhere in `apps/`, `packages/`,
`scripts/`, `examples/` (no examples/ or mini-services/ dirs in this repo).

## 3. External hosts and resolution

`packages/shared/src/zcodeEndpoint.ts`:

| Constant | Value | Line |
|---|---|---|
| `DEFAULT_ZCODE_ENDPOINT_ORIGIN` | `https://zcode.z.ai` | :3 |
| `DEFAULT_BIGMODEL_API_ORIGIN` | `https://bigmodel.cn` | :6 |
| `DEFAULT_ZAI_BUSINESS_BASE_URL` | `https://api.z.ai` | :10 |

Runtime resolution: `resolveRuntimeZCodeEndpointOrigin()` :204-222 (env
`ZCODE_BASE_URL` → `ZCODE_ENDPOINT_ORIGIN` → env-scoped production/test), plus a
desktop user setting override applied by `NodeApiClient`
(`packages/services/src/providers/api/nodeApiClient.ts:296`). Login/JWT host:
`https://zcode.z.ai/api/v1/oauth/token`
(`packages/services/src/oauth/providers/zaiProviderConfig.ts:23`).

## 4. Shared contract gaps (client-side)

`packages/shared/src/coding-plan-subscription.ts`:

- `StartPlanPreviewConfig` :126-130 — `{ planId, name, entitlements }`, **no owning
  product**.
- `ManualClaimPlanPreview` :144-150 — no owning product.
- `ManualClaimPlanClaimRequest` :158-160 — `{ planId }` + verification proof, **no
  product scope**.

## 5. Provider registry (preserved, not duplicated)

`packages/shared/src/model-provider-types.ts:7-14` — `account:zai-start-plan` /
`account:bigmodel-start-plan` provider ids; builtin definitions
`config/provider/zcode-builtin.json:1096-1115,1159-1178`; account-provider connection
resolution `packages/services/src/model-provider/accountProviderConnectionResolver.ts:91-274`;
model whitelist overlay `packages/provider/src/account-provider-resolution.ts:139-147`.

## 6. Cache key construction sites (product dimension missing today)

| Cache | Site | Current key |
|---|---|---|
| Client-configs snapshot (60 min) | `bigmodelCodingPlanSubscriptionProvider.ts:845` | `[url, authorization]` |
| Balance in-flight (~1 s) | `zaiStartPlanBilling.ts:76-79` | `{authorization, url}` |
| Generic client-config service | `clientConfigService.ts:92` | `[url, authorization]` |
| Renderer Start Plan preview (24 h) | `packages/ui/src/settings/model-provider-section/useStartPlanPreview.ts:13-15` | module-global (no user/product dimension) |
| Renderer usage entitlement (localStorage, 10 min) | `packages/ui/src/lib/usageEntitlementCache.ts:20-31` + auth suffix `packages/ui/src/hooks/useUsageEntitlement.ts:171-181` | `zcode:usage-entitlement:subscription-v2:<providerId>:<fingerprint>[:auth:<userId>:<seq>]` |

Note: separate desktop data roots (`~/.mos` vs ZCode's default) already isolate
renderer localStorage *across applications*; the product dimension in cache keys is
still required by the handoff (defense in depth, account-shared backends, remote
server mode).

## 7. Auth + device identity (distinct from product identity)

- JWT storage key `zcodejwttoken`; attached per request (§1 sites); model plane uses
  it as the account API key.
- `X-Device-Mid` is built in `packages/shared/src/zcode-source-headers.ts:57` from the
  telemetry state file and injected by `NodeApiClient` for endpoint-origin requests
  (`nodeApiClient.ts:149-180,322-329`). It identifies a **device**, not a product,
  and must not be reused as product scope (handoff §2C confirmed).
- Product identity today: `packages/shared/src/env.ts` — `ZCodeProductFlavor`
  (`"production" | "preview" | "mos"`) from the build-injected
  `__ZCODE_PRODUCT_FLAVOR__` define; consumed only for packaging/branding/update
  policy. **No product id exists on any billing request path today.**

## 8. Test infrastructure for this subsystem

- Dominant pattern: real local `node:http` mock server + env override of the endpoint
  origin (`packages/desktop/test/e2e/helpers/coding-plan-upgrade-mock-server.ts`,
  `coding-plan-mock-env.ts:96-125`), consumed by engineering tests
  (`packages/desktop/test/codingPlanUpgradeMockServer.test.ts`) and wdio e2e.
- Engineering test entry list: `scripts/engineering-test-files.json` (root vitest
  "engineering" project). New tests must be registered there to run in CI.

## 9. Ownership conclusion

| Surface | Owner | Where |
|---|---|---|
| Preview/claim client + contract types | this repo | `packages/services/src/coding-plan-subscription/**`, `packages/shared/src/coding-plan-subscription.ts` |
| Balance/quota/availability client | this repo | `zaiStartPlanBilling.ts`, `codingPlanProviderAvailability.ts`, `bigmodelUsageQuotaProvider.ts` |
| Entitlement caches | this repo | §6 sites |
| Model-plane request auth (usage debits) | this repo | `accountProviderRequestAuthService.ts` + provider-runtime-headers port |
| `client/configs`, `billing/preview`, `billing/claim`, `billing/balance` **servers** | **external provider (Z.AI/BigModel)** | `https://zcode.z.ai` — not in any payswapdotorg repo |
| Grant records, one-per-user-per-product enforcement, concurrency-safe claims, product-scoped debits | **external provider** | backend handoff: `docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md` |
