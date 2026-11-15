// fresh-install fixture —— 全周期编排：fresh state → reset → live registration →
// consent → credentials land → coding plan grant active。
//
// 与 run-platform-smoke 同一编排纪律：单一有序流水线、逐步落证据、任何一步失败都
// 继续写出证据并以非零码退出。驱动器（run-fresh-install-verification.mjs）只负责
// CLI/IO；本模块可注入 fetch/sleep/now 做无网络单测。
//
// 诚实边界（AGENTS.md §7）：consent 段需要真人完成浏览器授权 —— 无人值守运行的
// 预期终态就是 auth_timeout（exit 3），这不是 fixture 缺陷而是它要证明的事实；
// grant 段需要提供方启用 MOS 产品（Issue #23 workstream A）。fixture 绝不伪造
// 授权或凭据，证据里绝不落任何 secret（一律 fingerprint）。

import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInitRequest,
  buildPollRequest,
  CliOAuthWireError,
  createPollToken,
  parseEnvelope,
  parseInitData,
  parsePollData,
} from "./oauth-wire.mjs";
import {
  buildBillingBalanceUrl,
  buildBillingPreviewUrl,
  buildClientConfigsUrl,
  buildEndpointHeaders,
  classifyGrantState,
} from "./grant-wire.mjs";

export const SCHEMA = "mos-fresh-install-fixture/run@1";

/** 安装态的三个本地身份面（相对 dataRoot）。 */
export const INSTALLATION_SURFACES = [
  {
    key: "credential-store",
    // 镜像 apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts:398
    path: [".zcode", "v2", "credentials.json"],
    role: "keyring store (values encrypted by the local keyring cipher key)",
  },
  {
    key: "telemetry-state",
    // 镜像 packages/services/src/telemetry/telemetryCore.ts:132-137
    path: [".zcode", "v2", "telemetry-state.json"],
    role: "deviceMid source (X-Device-Mid)",
  },
  {
    key: "personal-provider-config",
    // 镜像 auth-login.ts:331-334 + provider-node runtime-paths.ts:5
    path: [".zcode", "v2", "provider_config.json"],
    role: "default model/provider connection config",
  },
];

export const CYCLE_VERDICTS = [
  "full-cycle-verified",
  "blocked-consent-timeout",
  "blocked-consent-denied",
  "blocked-auth-failed",
  "blocked-provider-not-configured",
  "blocked-authentication-required",
  "cycle-error",
];

export const VERDICT_EXIT_CODES = {
  "full-cycle-verified": 0,
  "blocked-consent-timeout": 3,
  "blocked-consent-denied": 4,
  "blocked-auth-failed": 4,
  "blocked-provider-not-configured": 5,
  "blocked-authentication-required": 6,
  "cycle-error": 1,
};

const DEFAULTS = {
  origin: "https://zcode.z.ai",
  productId: "mos",
  providerId: "zai",
  appVersion: "3.18.0",
  consentWaitMs: 5 * 60 * 1000,
};

export async function runFreshInstallCycle(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = config.now ?? Date.now;
  const log = config.log ?? (() => {});
  const startedAt = now();
  const evidence = {
    schema: SCHEMA,
    startedAt,
    config: {
      origin: config.origin,
      productId: config.productId,
      providerId: config.providerId,
      appVersion: config.appVersion,
      platform: config.platform ?? null,
      consentWaitMs: config.consentWaitMs,
      dataRootMode: config.dataRoot ? "provided" : "fixture-temp",
    },
    legs: [],
    observations: {},
    verdict: "cycle-error",
  };

  const record = (leg, status, detail = {}) => {
    evidence.legs.push({ leg, status, ...detail });
    log(`[${leg}] ${status}${detail.note ? ` — ${detail.note}` : ""}`);
  };

  try {
    // ── Leg 1: fresh state ────────────────────────────────────────────────
    const dataRoot = config.dataRoot ?? (await makeTempDataRoot());
    evidence.config.dataRootMode = config.dataRoot ? "provided" : "fixture-temp";
    evidence.dataRoot = dataRoot;
    const surfaces = INSTALLATION_SURFACES.map((surface) => ({
      ...surface,
      absolutePath: join(dataRoot, ...surface.path),
    }));
    const initial = await Promise.all(surfaces.map((s) => pathExists(s.absolutePath)));
    const dirty = surfaces.filter((_, i) => initial[i]);
    record(
      "fresh-state",
      dirty.length === 0 ? "fresh" : "dirty",
      dirty.length === 0
        ? { note: "no credential store, no telemetry state, no provider config" }
        : { note: `pre-existing: ${dirty.map((s) => s.key).join(", ")}` },
    );

    // ── Leg 2: reset ──────────────────────────────────────────────────────
    await Promise.all(
      surfaces
        .filter((_, i) => initial[i])
        .map((s) => rm(s.absolutePath, { force: true, recursive: true })),
    );
    const afterReset = await Promise.all(surfaces.map((s) => pathExists(s.absolutePath)));
    const stillDirty = surfaces.filter((_, i) => afterReset[i]);
    if (stillDirty.length > 0) {
      record("reset", "failed", {
        note: `could not remove: ${stillDirty.map((s) => s.key).join(", ")}`,
      });
      evidence.verdict = "cycle-error";
      return finalize(evidence, now);
    }
    record("reset", "clean", {
      note: dirty.length > 0 ? "removed pre-existing surfaces" : "nothing to remove (already fresh)",
    });

    // ── Leg 3: live registration（真实 init 调用，无任何账号材料）──────────
    const pollToken = createPollToken();
    const sourceHeaders = buildEndpointHeaders({
      productId: config.productId,
      appVersion: config.appVersion,
      platform: config.platform,
    });
    let initData;
    try {
      const initRequest = buildInitRequest({
        origin: config.origin,
        providerId: config.providerId,
        pollToken,
        extraHeaders: sourceHeaders,
      });
      const response = await fetchJson(fetchImpl, initRequest);
      initData = parseInitData(parseEnvelope(response.httpStatus, response.parsed));
    } catch (error) {
      record("live-registration", "failed", {
        error: errorName(error),
        note: "oauth/cli/init did not return a usable flow",
      });
      evidence.verdict = "blocked-auth-failed";
      return finalize(evidence, now);
    }
    record("live-registration", "ok", {
      flowId: fingerprint(initData.flowId),
      authorizeUrl: initData.authorizeUrl,
      authorizeUrlHost: hostOf(initData.authorizeUrl),
      expiresAt: initData.expiresAt,
      pollIntervalSec: initData.pollIntervalSec,
      note: "server issued a live authorization flow",
    });
    evidence.observations.authorizeUrl = initData.authorizeUrl;

    // 提供方产品目录观察（无凭据、只读）：未知产品 id 是否 fail-closed（handoff 契约）。
    evidence.observations.productCatalog = await probeProductCatalog({
      fetchImpl,
      config,
      sourceHeaders,
    });

    // ── Leg 4: consent（等待真人在 authorize_url 完成授权）────────────────
    // 轮询语义镜像 apps/zcode-cli/packages/bootstrap/src/auth-login-polling.ts
    // 的 pollUntilReady：先 poll 后 sleep、间隔下限 1000ms、瞬时错误（408/429/5xx/
    // 网络层）按服务端间隔重试，非瞬时业务/HTTP 错误判 auth-failed。
    const MIN_POLL_INTERVAL_MS = 1000;
    const deadline = now() + config.consentWaitMs;
    const effectiveDeadline = Math.min(deadline, initData.expiresAt * 1000);
    const pollIntervalMs = Math.max(MIN_POLL_INTERVAL_MS, initData.pollIntervalSec * 1000);
    let ready = null;
    let consentStatus = "auth_timeout";
    let consentNote = "no human completed the authorization in time (expected unattended)";
    while (now() < effectiveDeadline) {
      let pollData = { status: "pending" };
      try {
        const pollRequest = buildPollRequest({
          origin: config.origin,
          flowId: initData.flowId,
          pollToken,
          extraHeaders: sourceHeaders,
        });
        const response = await fetchJson(fetchImpl, pollRequest);
        pollData = parsePollData(parseEnvelope(response.httpStatus, response.parsed), config.providerId);
      } catch (error) {
        if (!isTransientPollError(error)) {
          consentStatus = "auth-failed";
          consentNote = `poll error: ${errorName(error)}`;
          break;
        }
        // 瞬时网络/服务端失败：按服务端间隔重试（与 App 轮询一致）。
      }
      if (now() >= effectiveDeadline) break;
      if (pollData.status === "ready") {
        ready = pollData;
        consentStatus = "consent-completed";
        consentNote = "human completed the authorization (server returned ready)";
        break;
      }
      if (pollData.status === "failed") {
        consentStatus = "consent-denied";
        consentNote = "server reported the authorization flow as failed";
        break;
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, effectiveDeadline - now())));
    }
    record("consent", consentStatus, {
      waitedMs: now() - startedAt,
      note: consentNote,
    });

    // ── Leg 5: credentials land ───────────────────────────────────────────
    let authorization = null;
    if (ready) {
      // ready 载荷即“凭据落地”的功能等价物：token(JWT) + user_id + provider access_token。
      // fixture 持有于内存、绝不落盘、证据只留指纹 —— keyring 持久化由 CLI 侧
      // auth-login.test.ts 覆盖，fixture 不复制那段实现。
      record("credentials", "landed", {
        jwtFingerprint: fingerprint(ready.token),
        accessTokenFingerprint: fingerprint(ready.accessToken),
        userIdFingerprint: fingerprint(ready.user.user_id),
        note: "server issued account credentials; held in memory only, never persisted",
      });
      authorization = `Bearer ${ready.token}`;
    } else {
      record("credentials", "not-reached", {
        note: `consent leg ended ${consentStatus}; no credentials can land`,
      });
    }

    // ── Leg 6: coding plan grant ──────────────────────────────────────────
    const grantObservations = [];
    const endpoints = [
      { kind: "client-configs", url: buildClientConfigsUrl(config) },
      { kind: "billing-preview", url: buildBillingPreviewUrl(config) },
      { kind: "billing-balance", url: buildBillingBalanceUrl(config) },
    ];
    for (const endpoint of endpoints) {
      const headers = buildEndpointHeaders({
        productId: config.productId,
        authorization,
        appVersion: config.appVersion,
        platform: config.platform,
      });
      try {
        const response = await fetchJson(fetchImpl, { url: endpoint.url, method: "GET", headers });
        grantObservations.push(describeObservation(endpoint.kind, response));
      } catch (error) {
        grantObservations.push({
          kind: endpoint.kind,
          ok: false,
          httpStatus: null,
          businessCode: null,
          parsed: null,
          transportError: errorName(error),
        });
      }
    }
    evidence.observations.grantEndpoints = grantObservations.map((o) => ({
      kind: o.kind,
      ok: o.ok,
      httpStatus: o.httpStatus,
      businessCode: o.businessCode,
      ...(o.transportError ? { transportError: o.transportError } : {}),
    }));
    const grantState = classifyGrantState({
      observations: grantObservations,
      currentProductId: config.productId,
    });
    record("grant", grantState, {
      note: grantNote(grantState, authorization !== null),
    });

    evidence.verdict = finalVerdict({ consentStatus, grantState });
    return finalize(evidence, now);
  } catch (error) {
    record("cycle-error", "error", { error: errorName(error) });
    evidence.verdict = "cycle-error";
    return finalize(evidence, now);
  }
}

/** 无人值守运行的预期终态映射；全周期成立只认 active-grant。 */
export function finalVerdict({ consentStatus, grantState }) {
  if (consentStatus === "consent-completed" && grantState === "active-grant") {
    return "full-cycle-verified";
  }
  if (consentStatus !== "consent-completed") {
    if (consentStatus === "auth_timeout") return "blocked-consent-timeout";
    if (consentStatus === "consent-denied") return "blocked-consent-denied";
    return "blocked-auth-failed";
  }
  if (grantState === "authentication-required") return "blocked-authentication-required";
  return "blocked-provider-not-configured";
}

/** 证据脱敏：secret 只允许以 sha256 前 12 位 + 长度出现。 */
export function fingerprint(value) {
  if (typeof value !== "string" || !value) return null;
  return `${createHash("sha256").update(value).digest("hex").slice(0, 12)} (len ${value.length})`;
}

async function makeTempDataRoot() {
  return mkdtemp(join(tmpdir(), "mos-fresh-install-"));
}

async function pathExists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(fetchImpl, request) {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { httpStatus: response.status, parsed, bodyLength: text.length };
}

function describeObservation(kind, response) {
  const businessCode = typeof response.parsed?.code === "number" ? response.parsed.code : null;
  const transportOk = response.httpStatus >= 200 && response.httpStatus < 500 && response.parsed !== null;
  return {
    kind,
    ok: transportOk && businessCode === 0,
    httpStatus: response.httpStatus,
    businessCode,
    parsed: response.parsed,
  };
}

/** 无凭据、只读的产品目录观察：未知产品 id 当前是否被服务端拒绝（handoff 契约要求 400）。 */
async function probeProductCatalog({ fetchImpl, config, sourceHeaders }) {
  const probe = { unknownProductIdRejected: null, probedWith: "unknown-xyz" };
  try {
    const response = await fetchJson(fetchImpl, {
      url: buildClientConfigsUrl(config),
      method: "GET",
      headers: { ...sourceHeaders, "X-ZCode-Product-Id": "unknown-xyz" },
    });
    probe.unknownProductIdRejected = response.httpStatus >= 400;
    probe.unknownProductHttpStatus = response.httpStatus;
  } catch (error) {
    probe.unknownProductIdRejected = null;
    probe.error = errorName(error);
  }
  return probe;
}

function grantNote(state, authenticated) {
  switch (state) {
    case "active-grant":
      return "server-issued active grant for this product";
    case "claimable":
      return "product-owned plan offered; grant not yet claimed";
    case "not-configured":
      return authenticated
        ? "server confirmed no plan for this product (provider has not enabled it — Issue #23 workstream A)"
        : "no product-owned records visible without account credentials";
    case "authentication-required":
      return "billing surface fail-closed: 401 without account JWT (device identity alone authorizes nothing)";
    default:
      return "backend unavailable/unknown; never reported as confirmed absence";
  }
}

/** 瞬时轮询错误：408/429/5xx 或非线协议错误（网络层）——按服务端间隔重试。 */
function isTransientPollError(error) {
  if (error instanceof CliOAuthWireError) {
    const status = error.httpStatus ?? 0;
    return status === 408 || status === 429 || status >= 500;
  }
  return true;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function errorName(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function finalize(evidence, now) {
  evidence.finishedAt = now();
  evidence.durationMs = evidence.finishedAt - evidence.startedAt;
  return evidence;
}
