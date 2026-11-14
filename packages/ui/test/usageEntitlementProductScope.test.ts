// 渲染层权益缓存键的产品范围维度（ACR-0001 P4）：
// zcode 与 mos 的缓存键必须互斥 —— 同 provider 同指纹下跨产品永不互读。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZCODE_PRODUCT_ID } from "@zcode/shared";
import {
  buildUsageEntitlementCacheKey,
  readCachedUsageEntitlementSnapshot,
  writeCachedUsageEntitlementSnapshot,
} from "../src/lib/usageEntitlementCache.js";

// node 环境无 window.localStorage；缓存读写走内存桩验证键的隔离语义。
const storage = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => [...storage.keys()][index] ?? null,
  removeItem: (key) => void storage.delete(key),
  setItem: (key, value) => void storage.set(key, value),
};

beforeEach(() => {
  storage.clear();
  (globalThis as { window?: unknown }).window = { localStorage: localStorageStub };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("buildUsageEntitlementCacheKey 产品维度", () => {
  it("默认取构建期派生的当前产品身份；显式产品维度写入键中", () => {
    const params = { providerId: "account:zai-start-plan", providerFingerprint: "fp-1" };
    const current = buildUsageEntitlementCacheKey(params);
    expect(current).toBe(
      `zcode:usage-entitlement:subscription-v2:${ZCODE_PRODUCT_ID}:account:zai-start-plan:fp-1`,
    );
    expect(current).toBe(buildUsageEntitlementCacheKey({ ...params, productId: "zcode" }));
    expect(current).not.toBe(buildUsageEntitlementCacheKey({ ...params, productId: "mos" }));
  });

  it("同键写入的快照只被同键读取 —— 产品隔离即键隔离", () => {
    const zcodeKey = buildUsageEntitlementCacheKey({
      providerId: "account:zai-start-plan",
      providerFingerprint: "fp-1",
      productId: "zcode",
    });
    const mosKey = buildUsageEntitlementCacheKey({
      providerId: "account:zai-start-plan",
      providerFingerprint: "fp-1",
      productId: "mos",
    });
    const snapshot = {
      authenticated: true,
      generatedAt: 1,
      context: { scope: "personal" },
      provider: null,
      remaining: null,
      subscription: null,
      quota: null,
    } as const;
    writeCachedUsageEntitlementSnapshot({ cacheKey: zcodeKey, snapshot });
    expect(readCachedUsageEntitlementSnapshot({ cacheKey: zcodeKey })).toEqual(snapshot);
    // mos 键下没有 zcode 的缓存条目（反之亦然）。
    expect(readCachedUsageEntitlementSnapshot({ cacheKey: mosKey })).toBeNull();
  });

  it("空 provider/指纹仍返回空键（不落缓存）", () => {
    expect(buildUsageEntitlementCacheKey({ providerId: "", providerFingerprint: "fp" })).toBe("");
    expect(
      buildUsageEntitlementCacheKey({ providerId: "p", providerFingerprint: "" }),
    ).toBe("");
  });
});
