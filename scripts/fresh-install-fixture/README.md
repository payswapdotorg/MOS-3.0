# Fresh-Install Verification Fixture

**Purpose:** certify, end to end, one full fresh-install cycle against the **live** provider
(`https://zcode.z.ai`): fresh state → reset → live registration → completed consent →
credentials land → a coding plan (Start Plan) grant is active.

The fixture is the acceptance driver for the Start Plan real-evidence runs
(`docs/release/FREE-MODEL-SETUP.md` Route A · Issue #23 workstream A acceptance). It makes
**real** network calls to the real OAuth and billing endpoints; it contains no mocks, and it
refuses to fabricate any leg it cannot genuinely complete.

## The cycle

| Leg | What the driver does | Verified by |
|---|---|---|
| 1. fresh state | data root (default: isolated temp dir) contains no credential store, no telemetry state (deviceMid source), no personal provider config | absence assertions on the three installation surfaces |
| 2. reset | removes any pre-existing surfaces and re-asserts absence — re-running the cycle with `--data-root` at an existing install reproduces the reinstall path | file removal + re-assertion |
| 3. live registration | `POST /api/v1/oauth/cli/init` with a locally generated random poll token and the product headers; server returns a real `flow_id` + `authorize_url` + polling interval. The authorize URL is **printed immediately** so an attending human can act on it during the wait | response-shape validation (mirrors `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts`) |
| 4. consent | polls `GET /api/v1/oauth/cli/poll/{flow_id}` until the server reports `ready` (a human completed authorization at the printed `authorize_url`), the flow fails, or the wait budget ends; a heartbeat every 30 s reports the remaining budget | poll loop + status classification |
| 5. credentials land | the `ready` payload must carry the account JWT, `user.user_id` and the provider access token; reported only as sha-256 fingerprints, held in memory, **never persisted, never logged** | ready-payload validation (mirrors the CLI login contract) |
| 6. coding plan grant | `GET client/configs`, `billing/preview`, `billing/balance` with the Bearer JWT + `X-ZCode-Product-Id` + `X-Device-Mid` (a per-run device id mirroring `ensureTelemetryDeviceMid` generation semantics, held in memory only) — `billing/balance` treats `X-Device-Mid` as a required parameter (`packages/services/src/node.ts:3594`), so the fixture carries it exactly like the real client; classified with the repo's product-ownership adjudication | `classifyGrantState` (mirrors `packages/shared/src/coding-plan-subscription.ts` ACR-0001 P3) |

Exit codes: `0` full cycle (active grant) · `3` `blocked-consent-timeout` (the **expected**
terminal state of an unattended run — no human completed consent) · `4` authorization
failed/denied · `5` `blocked-provider-not-configured` (consent completed, but the provider
has not enabled a plan for this product) · `6` `blocked-authentication-required` (billing
surface fail-closed without account JWT) · `1` fixture/usage error.

## Running it

```bash
# Unattended (CI/sandbox): proves fresh → reset → live registration, then stops at the
# designed mile — auth_timeout, because no human completes consent:
node scripts/fresh-install-fixture/run-fresh-install-verification.mjs \
  --evidence-out evidence.json --consent-wait-ms 120000

# Attended (acceptance machine, once the provider backend ships): a human opens the
# printed authorize_url and completes consent:
node scripts/fresh-install-fixture/run-fresh-install-verification.mjs \
  --evidence-out evidence.json --consent-wait-ms 300000
```

**Attended runbook.** The driver prints the `authorize_url` immediately after live
registration succeeds (not only at the end) and logs a `still waiting … Ns of budget left`
heartbeat every 30 s. The attending human opens the URL on any browser (the consent
surface is the `chat.z.ai` account login — Google/Email/GitHub/phone; it carries no
device or installation material, so any machine completes it), logs in with a real
Z.AI / BigModel account and approves. The server flips the flow to `ready`, the driver
lands the credentials (fingerprints only) and classifies the grant leg. Exit 0 happens
only on a server-issued active grant for the product under test.

Options: `--origin`, `--product mos|zcode`, `--provider zai|bigmodel`, `--app-version`,
`--platform`, `--data-root`, `--consent-wait-ms`, `--help`. Evidence JSON contains **no
secrets** — credentials appear only as `sha256:<12 hex> (len N)` fingerprints.

Unit tests (offline, no network): `node --test
scripts/fresh-install-fixture/fresh-install-fixture.test.mjs` — also part of
`pnpm run test:release`.

## Honest scope (read before trusting a run)

- The consent leg requires a **real human with a real Z.AI / BigModel account**. An
  unattended run ending in `auth_timeout` (exit 3) is the *correct* result, not a fixture
  failure — it is the exact mile where the previous driver stopped. Browser observation
  (2026-11-15, headless browser on the live authorize URL): the consent surface is the
  `chat.z.ai` account login (Google / Email / GitHub / phone); its “Skip for now” path
  proceeds anonymously and issues **no** OAuth code — there is no consent without an
  account login. This sandbox holds no account, so its live runs end `auth_timeout`.
- The grant leg requires the provider to have enabled the product (Issue #23 workstream A).
  As of 2026-11-15 the live server has not: unknown product ids are still accepted
  (not fail-closed) and no `mos`-owned plan/preview is served. A completed-consent run
  today must end `blocked-provider-not-configured` — **never** a fabricated grant.
- The fixture never writes credentials to disk, never relabels another product's grant, and
  never substitutes a custom-provider key for a Start Plan entitlement (Issue #23 hard rules).

## Installation identity — what the server keys grant issuance on

> Deliverable (a)'s missing half. The audit
> (`docs/handoff/START-PLAN-SOURCE-AUDIT.md` §7) leaves three candidate identity layers for
> "this installation". This section states the definitive answer.

**The server keys grant issuance on the authenticated account `user_id` — not on
`deviceMid`, not on the keyring cipher key.** To the billing server, "this installation"
is the logged-in account (plus, post-ACR-0001, the request's product scope). Installation-
local identifiers are telemetry and at-rest storage details that the grant lifecycle
deliberately outlives.

| Candidate | What it actually is | Where it lives | Does the server see it? | Can it key a grant? |
|---|---|---|---|---|
| **deviceMid** (`X-Device-Mid`) | a per-device telemetry identifier built from the local telemetry state file (`packages/shared/src/zcode-source-headers.ts`; state file `packages/services/src/telemetry/telemetryCore.ts`) | `<dataRoot>/.zcode/v2/telemetry-state.json` | sent as a header; a **required parameter** on `billing/balance` (`packages/services/src/node.ts:3594` — a request without it is rejected as a parameter error) and recorded only as **audit-log metadata** on claims (backend handoff §3) | **No.** The audit (§7) holds that it "identifies a device, not a product" and must not be reused as scope; the contract requires grants to survive device change and reinstall ("Reinstall MOS / new device → existing MOS grant recovered" — acceptance matrix #7); and live 2026-11-15: `billing/preview` and `billing/balance` fail closed with HTTP 401 **while the request carries `X-Device-Mid`** — the device id is a billing parameter, never an authorization key |
| **account `user_id`** | the identity the OAuth server returns in the `ready` payload and binds into the JWT (`zcodejwttoken`); the CLI uses it as the connection identity for the zai family (`apps/zcode-cli/packages/bootstrap/src/auth-login.ts`, "Z.ai 以账号用户 ID 作为连接身份") | server-side authenticated state; locally mirrored inside the encrypted credential store | **Yes — this is the grant-issuance identity.** `docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md` §3: *"Grant identity: `authenticated_user_id + registered_product_id + plan_id`"*, and the server "must resolve the entitlement boundary from authenticated state (JWT), never from the header alone" | **Yes.** One lifetime grant per authenticated user + registered product + free-grant program, "not per installation/device" (Issue #23 §A.6); the live billing surface returns 401 without the account JWT — device identity alone authorizes nothing |
| **keyring cipher key** | the at-rest encryption secret for the local credential store (`apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts` → `@zcode/shared/credential-security`) | generated locally, per data root, next to the credential file it protects | **No.** It never appears on any request path — the endpoint sweep in the audit found no header or body field carrying it; it is invisible to the server | **No.** A fresh install generates a fresh cipher key while the same grant must be recovered (acceptance #7); a grant keyed on it would break reinstall recovery, contradicting the contract |

**Wire-level corroboration (live, 2026-11-15, this fixture — now with `X-Device-Mid` on the
wire):**

1. The `authorize_url` the server issues carries **only OAuth protocol parameters**
   (`client_id`, `redirect_uri`, `state`, `response_type` — observed on every live run).
   No device id, no product id, no keyring material: the consent can be completed from
   any browser on any machine, and what lands is the account the human logged in with.
   A browser observation of the live consent surface (2026-11-15) confirms it is the
   `chat.z.ai` account login; skipping login proceeds anonymously and issues no code.
2. Without the account JWT, `billing/preview` and `billing/balance` fail closed with HTTP
   401 **even though the request carries `X-Device-Mid` and `X-ZCode-Product-Id`** (live
   re-run 2026-11-15 with the per-run device id on the wire; independently reproduced with
   direct probes with/without the device header — both 401). Authentication of the
   *account* is the gate; the device id is a required billing parameter that authorizes
   nothing.
3. A fresh data root (new deviceMid, new cipher key) is issued **no** grant state of its
   own. If the server keyed issuance on installation identity, a fresh install would mint
   a new free allocation on first claim; the contract — and the current fail-closed
   behavior — forbid exactly that.

**Scope caveat (honesty):** the definitive statement above is the delivered, reviewed
contract (ACR-0001 backend handoff + Issue #23) and the directly observed behavior of the
live wire. The MOS-scoped live proof — claim on the real account, reinstall/new-device grant
recovery, concurrent-claim uniqueness — executes when provider workstream A ships; until then
this fixture records the honest `not-configured` state. The repo does not own the billing
server and will not speculate beyond its contract about its internals
(`docs/handoff/START-PLAN-SOURCE-AUDIT.md` §9).
