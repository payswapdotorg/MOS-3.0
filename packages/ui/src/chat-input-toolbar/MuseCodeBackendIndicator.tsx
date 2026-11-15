import { useEffect, useSyncExternalStore } from "react";
import { Zap } from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import {
  getMuseCodeBackendState,
  setMuseCodeBackendSupported,
  subscribeMuseCodeBackendState,
} from "@/v4/museCodeBackendState.js";
// Muse Code 执行后端指示器（Issue #24 / ACR-0002；MC-D 按选型路由）。
//
// 职责（保持单一）：随 Composer 常驻，向 Host 查询当前 workspace 的后端视图
// （状态 + 设置 + CLI 能力），把 supported 双门控位同步进 commandFactory 的
// 信封携带条件；用户意图（enabled）只由 Settings 的开关写。查询失败按不支持
// 处理（fail-closed，绝不携带信封字段）。
// MC-D 展示态：当前选型即走委托（delegatedSelectionActive）→ active；后端可用
// 但选型未命中家族 → available（选择 Muse Spark Contributor 模型即走本机订阅）；
// CLI 不可用 → unavailable（警告色，回退普通模型路径）。

export function MuseCodeBackendIndicator({
  workspacePath,
  workspaceIdentity,
  delegatedSelectionActive = false,
}: {
  workspacePath?: string;
  workspaceIdentity?: string;
  /** 当前草稿/会话选型是否即走委托执行（MC-D；toolbar 传入）。 */
  delegatedSelectionActive?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { museCodeService } = useServices();
  const state = useSyncExternalStore(subscribeMuseCodeBackendState, getMuseCodeBackendState);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (!museCodeService || !workspacePath) {
        setMuseCodeBackendSupported(false);
        return;
      }
      try {
        const view = await museCodeService.getView({
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
        });
        if (!cancelled) {
          setMuseCodeBackendSupported(
            view.backendSupported && view.status.state === "installed",
          );
        }
      } catch {
        if (!cancelled) {
          setMuseCodeBackendSupported(false);
        }
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [museCodeService, workspacePath, workspaceIdentity]);

  if (!state.enabled) return null;
  const title = !state.supported
    ? intl.formatMessage({ id: "chat.toolbar.museCode.unavailable" })
    : delegatedSelectionActive
      ? intl.formatMessage({ id: "chat.toolbar.museCode.active" })
      : intl.formatMessage({ id: "chat.toolbar.museCode.available" });
  return (
    <ControlHintTooltip title={title}>
      <span
        aria-label={title}
        data-muse-code-backend-indicator="true"
        data-muse-code-supported={state.supported ? "true" : "false"}
        data-muse-code-delegated-selection={delegatedSelectionActive ? "true" : "false"}
        className={
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-ui-caption whitespace-nowrap " +
          (!state.supported
            ? "text-warning"
            : delegatedSelectionActive
              ? "text-foreground-subtle"
              : "text-foreground-subtle/70")
        }
      >
        <Zap aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="hidden min-w-0 truncate @xl/composer:inline-flex">
          {intl.formatMessage({ id: "chat.toolbar.museCode.label" })}
        </span>
      </span>
    </ControlHintTooltip>
  );
}
