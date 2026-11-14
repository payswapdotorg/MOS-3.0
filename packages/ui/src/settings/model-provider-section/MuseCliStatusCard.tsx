import { isMuseSessionProtocolApi } from "@zcode/provider";
import { InfoIcon, LoaderCircle, LogIn, LogOut, RotateCwIcon } from "lucide-react";
import { Fragment, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import {
  boundMuseCliErrorText,
  MUSE_CLI_SERVICE_UNAVAILABLE,
  useMuseCliStatus,
} from "./useMuseCliStatus.js";

/** 内置 Muse 模板 ID（config/provider/zcode-builtin.json，Issue #24 §3）。 */
export const MUSE_CODE_CLI_TEMPLATE_ID = "muse-code-cli";

/** documented 安装命令（非文案，不进 i18n）；与 CLI 官方安装脚本保持一致。 */
const MUSE_CLI_INSTALL_COMMAND_POSIX = "curl -fsSL https://dev.meta.ai/install.sh | bash";
const MUSE_CLI_INSTALL_COMMAND_WINDOWS = "irm https://dev.meta.ai/install.ps1 | iex";

/** 额度行渲染上限：字段名由本机 CLI 版本决定，这里只做有界容忍展示。 */
const MUSE_CLI_USAGE_ROW_LIMIT = 8;
/** 单行 usage 值的展示上限（CLI 输出已经是公开事实，这里只防超长字符串撑爆布局）。 */
const MUSE_CLI_USAGE_VALUE_MAX_LENGTH = 120;

/**
 * 判定设置页 Provider 是否为 Muse 本地 CLI 供应商。
 * 模板 ID 是权威判据；个别投影缺省 templateId 时按 api.type（muse-session-protocol）兜底。
 */
export function isMuseCliTemplateProvider(
  provider: Pick<ProviderSettingsFormProvider, "templateId" | "config">,
): boolean {
  return (
    provider.templateId === MUSE_CODE_CLI_TEMPLATE_ID ||
    isMuseSessionProtocolApi(provider.config.api)
  );
}

interface MuseCliUsageRow {
  readonly key: string;
  readonly value: string;
}

/** 把 usage JSON 的值折叠成有界单行文本；无法安全呈现的值返回 null（整行跳过）。 */
function formatMuseCliUsageValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return "—";
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;
    return boundedText(normalized);
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    const serialized = JSON.stringify(value);
    return serialized ? boundedText(serialized) : null;
  } catch {
    return null;
  }
}

function boundedText(value: string): string {
  return value.length > MUSE_CLI_USAGE_VALUE_MAX_LENGTH
    ? `${value.slice(0, MUSE_CLI_USAGE_VALUE_MAX_LENGTH - 1)}…`
    : value;
}

/**
 * usage 行解析：不发明字段名，按 CLI 实际返回的 key 原样展示，最多
 * MUSE_CLI_USAGE_ROW_LIMIT 行；超出部分只透出行数提示。
 */
export function resolveMuseCliUsageRows(usage: Record<string, unknown> | undefined): {
  readonly rows: readonly MuseCliUsageRow[];
  readonly hiddenRowCount: number;
} {
  const entries = Object.entries(usage ?? {});
  const rows: MuseCliUsageRow[] = [];
  for (const [key, value] of entries) {
    const formatted = formatMuseCliUsageValue(value);
    if (formatted === null) continue;
    rows.push({ key, value: formatted });
    if (rows.length >= MUSE_CLI_USAGE_ROW_LIMIT) break;
  }
  return { rows, hiddenRowCount: Math.max(0, entries.length - rows.length) };
}

type MuseCliActionNotice =
  | { readonly kind: "hint"; readonly messageId: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * Muse CLI 状态卡（Issue #24 §3，ACR-0002）。
 *
 * 只消费 documented CLI 命令产出的公开事实（安装/版本/登录态/订阅额度 JSON）。
 * 卡片明确告知：连接走本机 Muse Code CLI 登录态与订阅额度，不是 API Key、
 * 不是 OpenRouter；单独创建的 Meta API Key 属于按量付费模板。工具审批默认
 * 拒绝，ZCODE_MUSE_TOOL_APPROVAL=allow-once 才允许受限单次审批。
 */
export function MuseCliStatusCard() {
  const { intl } = useZCodeIntl();
  const { phase, status, error, loading, service, refresh } = useMuseCliStatus();
  const [actionPending, setActionPending] = useState<"connect" | "disconnect" | null>(null);
  const [actionNotice, setActionNotice] = useState<MuseCliActionNotice | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const installedVersionLabel = status?.installed
    ? status.version
      ? intl.formatMessage(
          { id: "settings.modelProvider.muse.status.installed" },
          { version: status.version },
        )
      : intl.formatMessage({ id: "settings.modelProvider.muse.status.installedNoVersion" })
    : null;

  const handleRecheck = () => {
    setActionNotice(null);
    void refresh();
  };

  const handleConnect = async () => {
    if (actionPending || !service || typeof service.startLogin !== "function") {
      setActionNotice({
        kind: "error",
        message: intl.formatMessage({
          id: "settings.modelProvider.muse.status.serviceUnavailable",
        }),
      });
      return;
    }
    setActionPending("connect");
    setActionNotice(null);
    try {
      // startLogin 只负责拉起 `muse login`（浏览器设备码流程）并立即返回；
      // 登录是否完成必须由用户回来自点 Recheck 确认，UI 不轮询。
      const result = await service.startLogin();
      setActionNotice(
        result.started
          ? { kind: "hint", messageId: "settings.modelProvider.muse.connect.startedHint" }
          : {
              kind: "error",
              message: intl.formatMessage(
                { id: "settings.modelProvider.muse.connect.startFailed" },
                { message: result.message ?? "" },
              ),
            },
      );
    } catch (caught) {
      // 与 hook 同一有界口径：日志与界面都不接收超长或未折叠的异常文本。
      const message = boundMuseCliErrorText(caught);
      logger.warn("[MuseCliStatusCard] 启动 muse login 失败", { error: message });
      setActionNotice({
        kind: "error",
        message: intl.formatMessage(
          { id: "settings.modelProvider.muse.connect.startFailed" },
          { message },
        ),
      });
    } finally {
      setActionPending(null);
    }
  };

  const handleDisconnectConfirm = async () => {
    if (actionPending || !service || typeof service.logout !== "function") {
      setDisconnectDialogOpen(false);
      return;
    }
    setActionPending("disconnect");
    try {
      const result = await service.logout();
      if (!result.ok) {
        setActionNotice({
          kind: "error",
          message: intl.formatMessage(
            { id: "settings.modelProvider.muse.disconnect.failed" },
            { message: result.message ?? "" },
          ),
        });
      }
    } catch (caught) {
      const message = boundMuseCliErrorText(caught);
      logger.warn("[MuseCliStatusCard] muse logout 失败", { error: message });
      setActionNotice({
        kind: "error",
        message: intl.formatMessage(
          { id: "settings.modelProvider.muse.disconnect.failed" },
          { message },
        ),
      });
    } finally {
      setDisconnectDialogOpen(false);
      setActionPending(null);
      // 无论登出成败都重新探测一次，让卡片收敛到 CLI 的真实状态。
      void refresh();
    }
  };

  const recheckLoading = loading && phase === "loading";
  const connectVisible = phase === "signed-out" || phase === "error";
  const disconnectVisible = phase === "signed-in";
  const usageRows = resolveMuseCliUsageRows(status?.usage);

  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
      data-testid="muse-cli-status-card"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-ui-base font-semibold text-foreground">
              {intl.formatMessage({ id: "settings.modelProvider.muse.statusCard.title" })}
            </h3>
            <MuseCliStatusBadge phase={phase} installedLabel={installedVersionLabel} />
          </div>
          <MuseCliStatusBody phase={phase} status={status} error={error} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRecheck}
            disabled={recheckLoading || actionPending !== null}
          >
            {recheckLoading ? (
              <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCwIcon aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.modelProvider.muse.action.recheck" })}
          </Button>
          {connectVisible ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={actionPending !== null || loading}
            >
              {actionPending === "connect" ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn aria-hidden="true" />
              )}
              {intl.formatMessage({ id: "settings.modelProvider.muse.action.connect" })}
            </Button>
          ) : null}
          {disconnectVisible ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDisconnectDialogOpen(true)}
              disabled={actionPending !== null}
            >
              {actionPending === "disconnect" ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut aria-hidden="true" />
              )}
              {intl.formatMessage({ id: "settings.modelProvider.muse.action.disconnect" })}
            </Button>
          ) : null}
        </div>
      </div>

      {actionNotice ? (
        <p
          role={actionNotice.kind === "error" ? "alert" : undefined}
          className={
            actionNotice.kind === "error"
              ? "text-ui-base text-destructive"
              : "text-ui-base text-foreground-subtle"
          }
          data-testid="muse-cli-status-card-notice"
        >
          {actionNotice.kind === "hint"
            ? intl.formatMessage({ id: actionNotice.messageId })
            : actionNotice.message}
        </p>
      ) : null}

      {phase === "not-installed" ? <MuseCliInstallHint /> : null}

      {phase === "signed-in" ? (
        <div className="space-y-2">
          <h4 className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.modelProvider.muse.usage.title" })}
          </h4>
          {usageRows.rows.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              {usageRows.rows.map((row) => (
                <Fragment key={row.key}>
                  <dt
                    className="min-w-0 truncate font-mono text-ui-sm text-foreground-subtle"
                    title={row.key}
                  >
                    {row.key}
                  </dt>
                  <dd className="min-w-0 break-words text-ui-base text-foreground">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.muse.usage.empty" })}
            </p>
          )}
          {usageRows.hiddenRowCount > 0 ? (
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.modelProvider.muse.usage.moreFields" },
                { count: usageRows.hiddenRowCount },
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <MuseCliExplainer />

      <AlertDialog
        open={disconnectDialogOpen}
        onOpenChange={(next) => {
          if (!next && actionPending !== "disconnect") setDisconnectDialogOpen(next);
        }}
      >
        <AlertDialogContent data-testid="muse-cli-disconnect-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: "settings.modelProvider.muse.disconnect.confirmTitle",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({
                id: "settings.modelProvider.muse.disconnect.confirmDescription",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" size="sm" disabled={actionPending !== null}>
              {intl.formatMessage({ id: "common.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              size="sm"
              disabled={actionPending !== null}
              onClick={(event) => {
                // 阻止 Radix 默认关闭：登出 + 重新探测是异步链路，由父状态收口。
                event.preventDefault();
                void handleDisconnectConfirm();
              }}
            >
              {actionPending === "disconnect" ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : null}
              {intl.formatMessage({ id: "settings.modelProvider.muse.disconnect.confirm" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MuseCliStatusBadge({
  phase,
  installedLabel,
}: {
  phase: ReturnType<typeof useMuseCliStatus>["phase"];
  installedLabel: string | null;
}) {
  const { intl } = useZCodeIntl();
  const labelId =
    phase === "signed-in"
      ? "settings.modelProvider.muse.status.signedIn"
      : phase === "signed-out"
        ? "settings.modelProvider.muse.status.signedOut"
        : phase === "not-installed"
          ? "settings.modelProvider.muse.status.notInstalled"
          : phase === "loading"
            ? "settings.modelProvider.muse.status.checking"
            : null;
  if (!labelId) return null;
  const className =
    phase === "signed-in"
      ? "border-success/40 bg-success/10 text-success"
      : phase === "signed-out"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-background text-foreground-subtle";
  return (
    <span
      className={`w-fit shrink-0 rounded-full border px-2 py-0.5 text-ui-sm font-medium ${className}`}
    >
      {intl.formatMessage({ id: labelId })}
      {phase === "signed-in" || phase === "signed-out"
        ? installedLabel
          ? ` · ${installedLabel}`
          : null
        : null}
    </span>
  );
}

function MuseCliStatusBody({
  phase,
  status,
  error,
}: {
  phase: ReturnType<typeof useMuseCliStatus>["phase"];
  status: ReturnType<typeof useMuseCliStatus>["status"];
  error: string | null;
}) {
  const { intl } = useZCodeIntl();
  if (phase === "loading") {
    return (
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.muse.status.checking" })}
      </p>
    );
  }
  if (phase === "not-installed") {
    return (
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.muse.status.notInstalledLong" })}
      </p>
    );
  }
  if (phase === "error") {
    if (error === MUSE_CLI_SERVICE_UNAVAILABLE) {
      return (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.muse.status.serviceUnavailable" })}
        </p>
      );
    }
    if (status?.installed && status.signedIn === undefined) {
      // 已安装但登录态未知（usage 未成功也未报 not logged in）：
      // 优先透出 Host 报告的有界摘要，缺省用稳定的兜底文案。
      return (
        <p className="text-ui-base text-foreground-subtle">
          {error
            ? intl.formatMessage(
                { id: "settings.modelProvider.muse.status.error" },
                { message: error },
              )
            : intl.formatMessage({ id: "settings.modelProvider.muse.status.unresolved" })}
        </p>
      );
    }
    return (
      <p className="text-ui-base text-destructive" role="alert">
        {intl.formatMessage(
          { id: "settings.modelProvider.muse.status.error" },
          { message: error ?? "" },
        )}
      </p>
    );
  }
  if (phase === "signed-out") {
    return (
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.muse.status.signedOutLong" })}
      </p>
    );
  }
  return (
    <p className="text-ui-base text-foreground-subtle">
      {intl.formatMessage({ id: "settings.modelProvider.muse.status.signedInLong" })}
    </p>
  );
}

function MuseCliInstallHint() {
  const { intl } = useZCodeIntl();
  const entries = [
    {
      key: "posix",
      label: intl.formatMessage({ id: "settings.modelProvider.muse.install.macosLinuxLabel" }),
      command: MUSE_CLI_INSTALL_COMMAND_POSIX,
    },
    {
      key: "windows",
      label: intl.formatMessage({ id: "settings.modelProvider.muse.install.windowsLabel" }),
      command: MUSE_CLI_INSTALL_COMMAND_WINDOWS,
    },
  ];
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.modelProvider.muse.install.title" })}
      </div>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.key} className="space-y-1">
            <div className="text-ui-sm text-foreground-subtle">{entry.label}</div>
            <code className="block overflow-x-auto rounded-md bg-surface px-2 py-1 font-mono text-ui-sm text-foreground">
              {entry.command}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function MuseCliExplainer() {
  const { intl } = useZCodeIntl();
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1.5 text-ui-base font-medium text-foreground">
        <InfoIcon className="size-3.5 text-foreground-subtle" aria-hidden="true" />
        {intl.formatMessage({ id: "settings.modelProvider.muse.explainer.title" })}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-ui-base leading-5 text-foreground-subtle">
        <li>{intl.formatMessage({ id: "settings.modelProvider.muse.explainer.localSignIn" })}</li>
        <li>{intl.formatMessage({ id: "settings.modelProvider.muse.explainer.payAsYouGo" })}</li>
        <li>
          {intl.formatMessage({ id: "settings.modelProvider.muse.explainer.toolApprovalPrefix" })}{" "}
          <code className="rounded bg-surface px-1 font-mono text-ui-sm text-foreground">
            ZCODE_MUSE_TOOL_APPROVAL=allow-once
          </code>
          {intl.formatMessage({ id: "settings.modelProvider.muse.explainer.toolApprovalSuffix" })}
        </li>
      </ul>
    </div>
  );
}
