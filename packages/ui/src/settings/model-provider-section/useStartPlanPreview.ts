import type { StartPlanPreviewConfig } from "@zcode/shared";
import { ZCODE_PRODUCT_ID } from "@zcode/shared";
import { useCallback, useEffect, useState } from "react";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { normalizeErrorMessage as normalizeCodingPlanErrorMessage } from "@/settings/model-provider-section/useCodingPlanProducts.js";

interface StartPlanPreviewState {
  preview: StartPlanPreviewConfig | null;
  loading: boolean;
  error: string | null;
}

const START_PLAN_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ACR-0001 P4 —— 预览缓存按 service 实例 + 产品范围隔离。
 * service 实例随登录/换号重建（hook 已依赖 service 身份），产品范围随构建期身份派生；
 * 旧实现是模块级全局缓存，换号或换产品后会串用上一下上下文的 Start Plan 预览。
 */
const previewCacheByService = new WeakMap<
  object,
  { productId: string; preview: StartPlanPreviewConfig | null; expiresAt: number }
>();
const previewRequestByService = new WeakMap<
  object,
  Promise<StartPlanPreviewConfig | null>
>();
// 测试辅助函数的默认槽位（无 service 引用时读写）。
let fallbackPreviewCache: {
  productId: string;
  preview: StartPlanPreviewConfig | null;
  expiresAt: number;
} | null = null;

function readPreviewCache(service: object | null): {
  preview: StartPlanPreviewConfig | null;
} | null {
  if (service && previewCacheByService.has(service)) {
    const entry = previewCacheByService.get(service)!;
    return entry.productId === ZCODE_PRODUCT_ID && entry.expiresAt > Date.now()
      ? entry
      : null;
  }
  if (!service && fallbackPreviewCache) {
    return fallbackPreviewCache.productId === ZCODE_PRODUCT_ID &&
      fallbackPreviewCache.expiresAt > Date.now()
      ? fallbackPreviewCache
      : null;
  }
  return null;
}

function writePreviewCache(
  service: object | null,
  preview: StartPlanPreviewConfig | null,
): void {
  const entry = {
    productId: ZCODE_PRODUCT_ID,
    preview,
    expiresAt: Date.now() + START_PLAN_PREVIEW_CACHE_TTL_MS,
  };
  if (service) previewCacheByService.set(service, entry);
  else fallbackPreviewCache = entry;
}

export function useStartPlanPreview(options?: { enabled?: boolean }) {
  const services = useOptionalServices();
  const service = services?.codingPlanSubscriptionService;
  const enabled = options?.enabled !== false;
  const [state, setState] = useState<StartPlanPreviewState>(() => {
    const cached = readPreviewCache(service ?? null);
    return {
      preview: cached?.preview ?? null,
      loading: enabled && Boolean(service) && !cached,
      error: null,
    };
  });

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState({
        preview: readPreviewCache(service ?? null)?.preview ?? null,
        loading: false,
        error: null,
      });
      return;
    }
    if (!service || typeof service.getStartPlanPreview !== "function") {
      setState({
        preview: null,
        loading: false,
        error: "service_unavailable",
      });
      return;
    }

    setState((current) => ({
      preview: current.preview,
      loading: true,
      error: null,
    }));

    try {
      const preview = await loadStartPlanPreview(service);
      setState({
        preview,
        loading: false,
        error: null,
      });
    } catch (error) {
      // Start Plan preview 和套餐列表共用 client/configs。
      // 远端返回 HTML/非 JSON 时也不能把解析错误原样显示到升级面板。
      const message = normalizeCodingPlanErrorMessage(error);
      logger.warn("[useStartPlanPreview] 读取 Start Plan 预览失败", {
        error: message,
      });
      setState({
        preview: null,
        loading: false,
        error: message,
      });
    }
  }, [enabled, service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}

export function clearStartPlanPreviewCacheForTest() {
  fallbackPreviewCache = null;
  // WeakMap 无法整体清空；逐 service 记录由 GC 与产品/身份守卫失效。
}

export function primeStartPlanPreviewCacheForTest(
  preview: StartPlanPreviewConfig | null,
) {
  fallbackPreviewCache = {
    productId: ZCODE_PRODUCT_ID,
    preview,
    expiresAt: Date.now() + START_PLAN_PREVIEW_CACHE_TTL_MS,
  };
}

async function loadStartPlanPreview(
  service: NonNullable<ReturnType<typeof useOptionalServices>>["codingPlanSubscriptionService"],
): Promise<StartPlanPreviewConfig | null> {
  if (!service) return null;
  const cached = readPreviewCache(service);
  if (cached) {
    return cached.preview;
  }
  const inflight = previewRequestByService.get(service);
  if (inflight) {
    return inflight;
  }

  // 远端配置一天内变化频率低，未登录设置页可能反复挂载，合并请求避免重复打 client/configs。
  const request = service.getStartPlanPreview();
  previewRequestByService.set(service, request);
  try {
    const preview = await request;
    writePreviewCache(service, preview);
    return preview;
  } finally {
    previewRequestByService.delete(service);
  }
}
