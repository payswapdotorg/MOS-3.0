import type { IMuseCliDetectionService, MuseCliStatus } from "@zcode/services";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

/**
 * Muse CLI 探测的状态机（Issue #24 §3）。
 *
 * 只消费 documented CLI 命令产出的公开事实（安装/版本/登录态/额度 JSON），
 * 不触碰凭证；错误信息只保留有界摘要，不转发 env 或路径。
 */
export type MuseCliStatusPhase = "loading" | "error" | "not-installed" | "signed-out" | "signed-in";

export interface MuseCliStatusState {
  readonly phase: MuseCliStatusPhase;
  readonly status: MuseCliStatus | null;
  /** transport / service 不可用错误；探测语义错误优先取 status.error。 */
  readonly error: string | null;
}

/** 服务缺失（旧 Host / 远端连接）时使用的稳定错误码，UI 按 i18n 文案展示。 */
export const MUSE_CLI_SERVICE_UNAVAILABLE = "service_unavailable";

/** 已安装但登录态未知（usage 既未成功也未报告 not logged in）时的兜底错误码。 */
export const MUSE_CLI_STATUS_UNRESOLVED = "muse_cli_status_unresolved";

/** UI 侧错误摘要上限：与 Host 侧 ~200 字符口径一致，超长内容截断。 */
const MUSE_CLI_ERROR_MESSAGE_MAX_LENGTH = 200;

/** 把一次探测结果（含 transport 错误）折叠为 UI 状态；纯函数供测试锁定。 */
export function resolveMuseCliStatusState(
  status: MuseCliStatus | null,
  error: string | null,
): MuseCliStatusState {
  if (error) {
    return { phase: "error", status: null, error };
  }
  if (!status) {
    return { phase: "loading", status: null, error: null };
  }
  if (!status.installed) {
    return { phase: "not-installed", status, error: null };
  }
  if (status.signedIn === false) {
    return { phase: "signed-out", status, error: null };
  }
  if (status.signedIn === true) {
    return { phase: "signed-in", status, error: null };
  }
  // 已安装但 usage 未给出登录态：优先透出 service 报告的有界错误摘要。
  return {
    phase: "error",
    status,
    error: status.error ?? MUSE_CLI_STATUS_UNRESOLVED,
  };
}

/**
 * 把任意抛出值折叠成有界单行错误摘要（≤200 字符）。
 * 导出供状态卡复用：startLogin / logout 的异常与 transport 错误同一口径，避免超长文本进日志或界面。
 */
export function boundMuseCliErrorText(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return MUSE_CLI_STATUS_UNRESOLVED;
  return normalized.length > MUSE_CLI_ERROR_MESSAGE_MAX_LENGTH
    ? `${normalized.slice(0, MUSE_CLI_ERROR_MESSAGE_MAX_LENGTH - 1)}…`
    : normalized;
}

/**
 * 读取一次探测结果并折叠为 UI 状态；独立于 React 导出供测试锁定
 * （service 缺失 / 抛错 / 各探测语义的状态投影）。
 */
export async function loadMuseCliStatus(
  service: IMuseCliDetectionService | null | undefined,
): Promise<MuseCliStatusState> {
  // 可选能力守卫：旧 Host、远端与测试 double 不提供 getStatus 时不发起 RPC。
  if (!service || typeof service.getStatus !== "function") {
    return { phase: "error", status: null, error: MUSE_CLI_SERVICE_UNAVAILABLE };
  }
  try {
    const status = await service.getStatus();
    return resolveMuseCliStatusState(status, null);
  } catch (error) {
    const message = boundMuseCliErrorText(error);
    logger.warn("[useMuseCliStatus] Muse CLI 探测失败", { error: message });
    return { phase: "error", status: null, error: message };
  }
}

interface MuseCliStatusSnapshot {
  readonly status: MuseCliStatus | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/** 快照 → 展示状态：recheck 期间保留旧事实（loading 只驱动按钮转圈），首刷才显示 loading。 */
function resolveMuseCliSnapshotState(snapshot: MuseCliStatusSnapshot): MuseCliStatusState {
  if (snapshot.loading && snapshot.status === null && snapshot.error === null) {
    return { phase: "loading", status: null, error: null };
  }
  return resolveMuseCliStatusState(snapshot.status, snapshot.error);
}

export function useMuseCliStatus(options?: { enabled?: boolean }) {
  const services = useOptionalServices();
  const service = services?.museCliDetectionService;
  const enabled = options?.enabled !== false;
  const [snapshot, setSnapshot] = useState<MuseCliStatusSnapshot>(() => ({
    status: null,
    error: null,
    loading: enabled,
  }));
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async (): Promise<MuseCliStatusState> => {
    if (!enabled) {
      return resolveMuseCliSnapshotState(snapshotRef.current);
    }
    // 刷新期间清掉 transport 错误但保留旧事实，避免卡片在等待时闪回 loading。
    setSnapshot((current) => ({ ...current, loading: true, error: null }));
    const next = await loadMuseCliStatus(service);
    setSnapshot({ status: next.status, error: next.error, loading: false });
    return next;
  }, [enabled, service]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadMuseCliStatus(service).then((next) => {
      if (!cancelled) {
        setSnapshot({ status: next.status, error: next.error, loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, service]);

  return {
    ...resolveMuseCliSnapshotState(snapshot),
    loading: snapshot.loading,
    service,
    refresh,
  };
}
