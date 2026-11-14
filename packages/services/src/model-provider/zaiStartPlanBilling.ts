import type { ApiClient } from "@zcode/shared";
import {
  buildRuntimeZCodeEndpointUrls,
  isStartPlanRecordOwnedByCurrentProduct,
  normalizeOfficialGlmModelId,
  ZCODE_PRODUCT_ID,
  type ZCodeProductId,
  ZCODE_VERSION,
} from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";

const REQUEST_TIMEOUT_MS = 15_000;
const ZAI_START_PLAN_BALANCE_URL = buildRuntimeZCodeEndpointUrls(
  process.env,
).zcodePlanBillingBalanceUrl;

export interface ZaiStartPlanPlan {
  // user_plan_id 标识用户套餐实例；额度提醒用它关联同一实例的 entitlement 周期类型。
  user_plan_id?: string;
  plan_id?: string;
  // ACR-0001 P3：归属产品（服务端 product_id）；缺省 = 旧后端共享配置，仅 zcode 产品可消费。
  product_id?: string | null;
  name?: string;
  status?: string;
  starts_at?: number | string | null;
  ends_at?: number | string | null;
  entitlements?: Array<{
    entitlement_id?: string | null;
    show_name?: string | null;
    period?: string | null;
    effective_at?: number | string | null;
  }>;
}

export interface ZaiStartPlanBalanceEnvelope {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    server_time?: number;
    plans?: ZaiStartPlanPlan[];
    balances?: Array<{
      bucket_id?: string;
      user_plan_id?: string;
      plan_id?: string;
      entitlement_id?: string;
      show_name?: string;
      meter?: string;
      unit_type?: string;
      capabilities?: string[];
      total_units?: number | string | null;
      used_units?: number | string | null;
      reserved_units?: number | string | null;
      remaining_units?: number | string | null;
      available_units?: number | string | null;
      period_start?: number | string | null;
      period_end?: number | string | null;
      expires_at?: number | string | null;
    }>;
  };
}

const inflightBalanceRequests = new WeakMap<
  ApiClient,
  Map<string, Promise<ZaiStartPlanBalanceEnvelope>>
>();

export function buildZaiStartPlanBalanceUrl(): string {
  const url = new URL(ZAI_START_PLAN_BALANCE_URL);
  // Start Plan balance 接口按真实 app_version 判定能力；
  // 开发环境也不能固定 3.0.0，否则本地验证会绕过当前 App 版本的后端策略。
  url.searchParams.set("app_version", ZCODE_VERSION);
  return url.toString();
}

/** fetchZaiStartPlanBalanceEnvelope 的产品范围选项（ACR-0001 P4）。 */
export interface FetchZaiStartPlanBalanceOptions {
  /**
   * 当前 API 产品身份；缺省为构建期派生的 ZCODE_PRODUCT_ID。仅供可信 composition /
   * 工程测试注入 —— 决定响应过滤与缓存键，不得来自用户偏好或渲染层输入。
   */
  productId?: ZCodeProductId;
}

export async function fetchZaiStartPlanBalanceEnvelope(
  apiClient: ApiClient,
  authorization: string,
  invalidateCache = false,
  options: FetchZaiStartPlanBalanceOptions = {},
): Promise<ZaiStartPlanBalanceEnvelope> {
  // ACR-0001 P4：balance 缓存键包含产品范围 —— 同一账号同一 URL 下 zcode 与 mos 的
  // 余额响应不同，缓存不得跨产品复用。
  const productId = options.productId ?? ZCODE_PRODUCT_ID;
  const requestKey = JSON.stringify({
    authorization: authorization.trim(),
    url: buildZaiStartPlanBalanceUrl(),
    productId,
  });

  let requests = inflightBalanceRequests.get(apiClient);
  if (!requests) {
    requests = new Map();
    inflightBalanceRequests.set(apiClient, requests);
  }

  if (invalidateCache) requests.delete(requestKey);
  const inflight = requests.get(requestKey);
  if (inflight) {
    return inflight;
  }

  const url = buildZaiStartPlanBalanceUrl();
  const startedAt = Date.now();
  let responseTime: number | undefined;
  const observedApi: ApiClient = {
    request: async (input, init) => {
      const response = await apiClient.request(input, init);
      const date = Date.parse(response.headers.get("date") ?? "");
      if (Number.isFinite(date)) responseTime = date / 1000;
      return response;
    },
  };
  const request = readApiJson<ZaiStartPlanBalanceEnvelope>(observedApi, url, {
    method: "GET",
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: authorization,
    },
  })
    .then((payload) =>
      normalizeStartPlanExpiry(payload, responseTime),
    )
    .then((payload) => filterStartPlanEnvelopeByProduct(payload, productId))
    .finally(() => {
      // 账号校验先完成，用量查询随后到达：保留同一响应至发起后 1 秒。
      // 失败同样保留，避免 429 之后立刻重复请求；旧请求不得删除失效后创建的新记录。
      const evict = () => {
        if (requests?.get(requestKey) !== request) return;
        requests.delete(requestKey);
        if (requests.size === 0) inflightBalanceRequests.delete(apiClient);
      };
      const remainingMs = 1000 - (Date.now() - startedAt);
      if (remainingMs > 0) setTimeout(evict, remainingMs);
      else evict();
    });

  requests.set(requestKey, request);
  return request;
}

export function resolveZaiStartPlanBalanceModelIds(payload: ZaiStartPlanBalanceEnvelope): string[] {
  const seen = new Set<string>();
  const modelIds: string[] = [];

  for (const balance of payload.data?.balances ?? []) {
    const fromCapabilities = (balance.capabilities ?? [])
      .map((capability) => {
        const normalized = capability.trim();
        return normalized.toLowerCase().startsWith("model:")
          ? normalized.slice("model:".length).trim()
          : "";
      })
      .filter(Boolean);
    const candidates = fromCapabilities.length > 0 ? fromCapabilities : [balance.show_name ?? ""];
    for (const candidate of candidates) {
      const modelId = normalizeOfficialGlmModelId(candidate.trim());
      const key = modelId.toLowerCase();
      if (!modelId || seen.has(key)) {
        continue;
      }
      seen.add(key);
      modelIds.push(modelId);
    }
  }

  return modelIds;
}

/** HTTP Date 与本次响应配对，避免旧 JSON 时间让过期 active 记录继续提供权益。 */
function normalizeStartPlanExpiry(
  payload: ZaiStartPlanBalanceEnvelope,
  responseTime?: number,
): ZaiStartPlanBalanceEnvelope {
  if (!payload.data) return payload;
  const serverTime = payload.data.server_time;
  const now =
    responseTime ??
    (typeof serverTime === "number" && Number.isFinite(serverTime) && serverTime >= 0
      ? serverTime
      : Date.now() / 1000);
  const plans = (payload.data.plans ?? []).map((plan) => {
    const end = Number(plan.ends_at);
    return plan.status?.trim().toLowerCase() === "active" &&
      Number.isFinite(end) &&
      end > 0 &&
      end <= now
      ? { ...plan, status: "expired" }
      : plan;
  });
  const balances = payload.data.balances?.filter((balance) => {
    const owners = plans.filter((plan) =>
      balance.user_plan_id && plan.user_plan_id
        ? plan.user_plan_id === balance.user_plan_id
        : plan.plan_id === balance.plan_id,
    );
    // 无归属桶继续由既有诊断处理，不能误删同商品另一个有效实例的余额。
    return !owners.length || owners.some((plan) => plan.status?.trim().toLowerCase() !== "expired");
  });
  return { ...payload, data: { ...payload.data, plans, balances } };
}

/**
 * ACR-0001 P3 —— 按当前产品过滤 balance envelope（单一裁决点，availability / quota / UI
 * 的所有消费方都只看到本产品拥有的记录）：
 *
 * - plan 声明了归属产品且与当前产品不符（含未知 id）→ 丢弃；
 * - plan 未声明归属（旧后端共享配置）→ 仅默认产品 zcode 保留；mos 等衍生产产品一律丢弃，
 *   上层因此判 coding_plan_not_entitled / no_plan —— 不制造权益，也不消费 zcode 的分配；
 * - 余额桶随其所属 plan 一并丢弃；无归属桶沿用既有“无归属桶”诊断语义，不误删。
 */
function filterStartPlanEnvelopeByProduct(
  payload: ZaiStartPlanBalanceEnvelope,
  productId: ZCodeProductId,
): ZaiStartPlanBalanceEnvelope {
  if (!payload.data) return payload;
  const plans = (payload.data.plans ?? []).filter((plan) =>
    isStartPlanRecordOwnedByCurrentProduct(plan.product_id, productId),
  );
  if (plans.length === (payload.data.plans ?? []).length) {
    return payload;
  }
  const allPlans = payload.data.plans ?? [];
  const balances = payload.data.balances?.filter((balance) => {
    const isAttachedTo = (plan: ZaiStartPlanPlan) =>
      balance.user_plan_id && plan.user_plan_id
        ? plan.user_plan_id === balance.user_plan_id
        : plan.plan_id === balance.plan_id;
    // 依附于保留 plan 的桶保留；从未归属任何 plan 的桶沿用“无归属桶”诊断语义保留；
    // 只依附于被产品过滤掉的 plan 的桶随该 plan 一并丢弃。
    if (plans.some(isAttachedTo)) return true;
    return !allPlans.some(isAttachedTo);
  });
  return { ...payload, data: { ...payload.data, plans, balances } };
}
