// fresh-install fixture —— 计费/权益面的线协议与产品归属裁决。
//
// 请求形状镜像真实客户端：
//   - client/configs：GET + app_version + platform（Bearer 可选）——
//     packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts (getClientConfigs)
//   - billing/preview：GET + app_version + platform（Bearer 可选）——同文件 (getManualClaimPlanPreviews)
//   - billing/balance：GET + app_version（Bearer 必需）——
//     packages/services/src/model-provider/zaiStartPlanBilling.ts (fetchZaiStartPlanBalanceEnvelope)
// 产品归属裁决逐行移植 packages/shared/src/coding-plan-subscription.ts
// 的 isStartPlanRecordOwnedByCurrentProduct()（ACR-0001 P3 单一实现）。
//
// classifyGrantState() 把三端响应折叠成 Issue #23 B.3 要求的状态区分：
// authentication-required / unavailable / not-configured / claimable / active-grant。
// 「后端不可用」永远不得折叠成「确认无权益」（fail-closed）。

export const GRANT_STATES = [
  "authentication-required",
  "unavailable",
  "not-configured",
  "claimable",
  "active-grant",
];

/**
 * ACR-0001 P3 —— 计费/权益记录的产品归属裁决（preview/claimable/balance 共用）。
 * 移植自 packages/shared/src/coding-plan-subscription.ts:203。
 *
 * - 声明了归属产品：必须与当前产品 id 完全一致才算本产品记录（未知/他产品一律拒绝）。
 * - 未声明归属：视为旧后端的共享 zcode 配置，只有默认产品 `zcode` 可以继续消费；
 *   `mos` 不得把共享配置推断为自己的权益（handoff W2）。
 */
export function isStartPlanRecordOwnedByCurrentProduct(recordProductId, currentProductId) {
  const declared = typeof recordProductId === "string" ? recordProductId.trim() : "";
  if (!declared) {
    return currentProductId === "zcode";
  }
  return declared === currentProductId;
}

/** 端点请求头：产品范围 + 来源头（镜像 buildZCodeSourceHeadersFromContext 的子集）。 */
export function buildEndpointHeaders({ productId, authorization, appVersion, platform }) {
  const headers = {
    "User-Agent": `ZCode/${appVersion}`,
    ...(productId ? { "X-ZCode-Product-Id": productId } : {}),
  };
  if (platform) headers["X-Platform"] = platform;
  if (authorization) headers.Authorization = authorization;
  return headers;
}

export function buildClientConfigsUrl({ origin, appVersion, platform }) {
  return withParams(`${normalizeBaseUrl(origin)}/api/v1/client/configs`, { appVersion, platform });
}

export function buildBillingPreviewUrl({ origin, appVersion, platform }) {
  return withParams(`${normalizeBaseUrl(origin)}/api/v1/zcode-plan/billing/preview`, {
    appVersion,
    platform,
  });
}

export function buildBillingBalanceUrl({ origin, appVersion }) {
  return withParams(`${normalizeBaseUrl(origin)}/api/v1/zcode-plan/billing/balance`, { appVersion });
}

/**
 * 把（可能多个的）端点观察折叠成单一授权状态。
 *
 * @param {object} input
 * @param {Array<{kind: string, httpStatus: number|null, ok: boolean, businessCode: number|null, parsed: object|null}>} input.observations
 *   每个端点一次观察；ok=false 表示传输/HTTP 层失败（网络错误、5xx、非 JSON）。
 *   认证状态由 401 观察自身携带（无凭据的请求会被计费面拒之门外）。
 * @param {string} input.currentProductId 当前产品 id（mos/zcode）。
 */
export function classifyGrantState({ observations, currentProductId }) {
  // 1) 任何 401 ⇒ 需要认证（fail-closed：绝不当作“确认无权益”）。
  if (observations.some((o) => o.httpStatus === 401)) {
    return "authentication-required";
  }
  // 2) 传输/HTTP 层失败或业务错误 ⇒ 后端不可用/未知（Issue #23 B.3：不得渲染成缺失）。
  if (observations.some((o) => !o.ok)) {
    return "unavailable";
  }
  // 3) 有本产品 record ⇒ claimable / active-grant（balance 里的 active 记录优先）。
  let ownedClaimable = false;
  for (const o of observations) {
    for (const record of extractOwnedRecords(o.parsed, currentProductId)) {
      if (isActiveGrantRecord(record)) return "active-grant";
      ownedClaimable = true;
    }
  }
  if (ownedClaimable) return "claimable";
  // 4) 响应成功且没有任何本产品 record ⇒ 服务端确认该产品未配置（当前 mos 的真实状态）。
  return "not-configured";
}

/** 从 configs/preview/balance 三种响应里提取「本产品拥有」的 record（flat 化，纯函数）。 */
export function extractOwnedRecords(parsed, currentProductId) {
  const records = [];
  const data = asRecord(parsed?.data);
  // client/configs → data.startPlanPreview
  const preview = asRecord(data?.startPlanPreview);
  if (preview) {
    if (isStartPlanRecordOwnedByCurrentProduct(preview.productId ?? preview.product_id, currentProductId)) {
      records.push({ source: "client-configs", ...preview });
    }
  }
  // preview/balance → data.plans[]
  for (const plan of Array.isArray(data?.plans) ? data.plans : []) {
    const planRecord = asRecord(plan);
    if (!planRecord) continue;
    if (isStartPlanRecordOwnedByCurrentProduct(planRecord.product_id, currentProductId)) {
      records.push({ source: "plans", ...planRecord });
    }
  }
  return records;
}

/** active 判据：服务端 status 为激活态且带 user_plan_id（grant 实例标识）。 */
export function isActiveGrantRecord(record) {
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  return Boolean(record.user_plan_id) && (status === "active" || status === "activated");
}

function withParams(url, { appVersion, platform }) {
  const target = new URL(url);
  if (appVersion) target.searchParams.set("app_version", appVersion);
  if (platform) target.searchParams.set("platform", platform);
  return target.toString();
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/u, "");
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
