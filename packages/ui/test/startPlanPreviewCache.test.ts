// Issue #23：Start Plan 预览负向缓存的 TTL 语义与强制刷新合同。
// 1) 负向（null）预览只允许 5 分钟 TTL —— provider 上线本产品免费计划后，
//    运行中的客户端最迟 5 分钟（或点击刷新）必须能看到，不得等 24 小时；
// 2) loadStartPlanPreview 的 force 路径绕过本地缓存并向 service 传 forceRefresh，
//    由 service 侧清 1h client/configs 平台快照重拉（services 侧合同另由
//    packages/services/test/codingPlanProductScope.test.ts 锁定）；
// 3) invalidateStartPlanPreviewCache 供领取成功等关键节点与权益/余额缓存一起失效。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { StartPlanPreviewConfig } from "@zcode/shared";
import { ZCODE_PRODUCT_ID } from "@zcode/shared";
import {
  clearStartPlanPreviewCacheForTest,
  invalidateStartPlanPreviewCache,
  loadStartPlanPreview,
  primeStartPlanPreviewCacheForTest,
  readStartPlanPreviewCacheEntryForTest,
  resolveStartPlanPreviewCacheTtlMs,
  START_PLAN_PREVIEW_NEGATIVE_CACHE_TTL_MS,
} from "../src/settings/model-provider-section/useStartPlanPreview.js";

const PREVIEW: StartPlanPreviewConfig = {
  planId: "zcode-v3-start-plan",
  name: "Start Plan",
  entitlements: [
    {
      grantUnits: 100,
      meter: "request",
      period: "monthly",
      showName: "Free requests",
      unitType: "request",
    },
  ],
};

/** 只实现 getStartPlanPreview 的 service 桩；记录每次调用的 options。 */
function createServiceStub(initial: StartPlanPreviewConfig | null) {
  let next = initial;
  const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
  const service = {
    getStartPlanPreview: async (options?: { forceRefresh?: boolean }) => {
      calls.push(options);
      return next;
    },
  };
  return {
    service: service as unknown as ICodingPlanSubscriptionService,
    calls,
    setNext: (value: StartPlanPreviewConfig | null) => {
      next = value;
    },
  };
}

beforeEach(() => {
  clearStartPlanPreviewCacheForTest();
});

afterEach(() => {
  clearStartPlanPreviewCacheForTest();
});

describe("TTL 语义（Issue #23：负向短 TTL、正向长 TTL）", () => {
  it("resolveStartPlanPreviewCacheTtlMs：null → 5 分钟；正向 → 24 小时", () => {
    expect(resolveStartPlanPreviewCacheTtlMs(null)).toBe(START_PLAN_PREVIEW_NEGATIVE_CACHE_TTL_MS);
    expect(resolveStartPlanPreviewCacheTtlMs(null)).toBe(5 * 60 * 1000);
    expect(resolveStartPlanPreviewCacheTtlMs(PREVIEW)).toBe(24 * 60 * 60 * 1000);
    expect(resolveStartPlanPreviewCacheTtlMs(PREVIEW)).toBeGreaterThan(
      resolveStartPlanPreviewCacheTtlMs(null),
    );
  });

  it("prime 写入的缓存条目按正负向使用不同过期窗口", () => {
    const before = Date.now();
    primeStartPlanPreviewCacheForTest(null);
    const negativeEntry = readStartPlanPreviewCacheEntryForTest();
    expect(negativeEntry?.preview).toBeNull();
    expect(negativeEntry?.productId).toBe(ZCODE_PRODUCT_ID);
    expect(negativeEntry?.expiresAt - before).toBeLessThanOrEqual(
      START_PLAN_PREVIEW_NEGATIVE_CACHE_TTL_MS,
    );
    expect(negativeEntry?.expiresAt - before).toBeGreaterThan(
      START_PLAN_PREVIEW_NEGATIVE_CACHE_TTL_MS - 5_000,
    );

    primeStartPlanPreviewCacheForTest(PREVIEW);
    const positiveEntry = readStartPlanPreviewCacheEntryForTest();
    expect(positiveEntry?.preview).toEqual(PREVIEW);
    expect(positiveEntry?.expiresAt - before).toBeGreaterThan(
      START_PLAN_PREVIEW_NEGATIVE_CACHE_TTL_MS,
    );
  });
});

describe("loadStartPlanPreview 缓存与 force 合同", () => {
  it("默认路径命中负向缓存；force 绕过缓存并向 service 传 forceRefresh", async () => {
    const { service, calls, setNext } = createServiceStub(null);

    // 首次：真实调用（负向结果写入短 TTL 缓存）。
    expect(await loadStartPlanPreview(service)).toBeNull();
    expect(calls.length).toBe(1);
    expect(calls[0]).toBeUndefined();

    // 二次：负向 TTL 未过 → 命中缓存，不打远端。
    expect(await loadStartPlanPreview(service)).toBeNull();
    expect(calls.length).toBe(1);

    // provider 上线（桩改返回正向预览）：不带 force 仍读到缓存的负向结果。
    setNext(PREVIEW);
    expect(await loadStartPlanPreview(service)).toBeNull();
    expect(calls.length).toBe(1);

    // force：绕过本地缓存 + service 收到 forceRefresh（清 1h 快照）→ 拿到新结果。
    expect(await loadStartPlanPreview(service, { force: true })).toEqual(PREVIEW);
    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual({ forceRefresh: true });

    // force 之后新结果进入缓存：再次默认调用命中缓存。
    expect(await loadStartPlanPreview(service)).toEqual(PREVIEW);
    expect(calls.length).toBe(2);
  });

  it("invalidateStartPlanPreviewCache 后的下一次默认调用重新拉取", async () => {
    const { service, calls } = createServiceStub(PREVIEW);

    expect(await loadStartPlanPreview(service)).toEqual(PREVIEW);
    expect(calls.length).toBe(1);

    // 领取成功等关键节点的主动失效（Issue #23）。
    invalidateStartPlanPreviewCache(service);
    expect(await loadStartPlanPreview(service)).toEqual(PREVIEW);
    expect(calls.length).toBe(2);
  });

  it("service 为 null 时安全返回 null（不抛错、不缓存）", async () => {
    expect(await loadStartPlanPreview(null)).toBeNull();
    expect(await loadStartPlanPreview(null, { force: true })).toBeNull();
  });
});
