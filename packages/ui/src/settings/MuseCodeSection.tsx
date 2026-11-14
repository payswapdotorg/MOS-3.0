// 设置页「Meta Muse Code (local CLI)」分区（Issue #24 / ACR-0002）。
//
// 职责：
//  - 展示 CLI 状态（安装/版本、登录、Contributor 模式——只来自已验证的探针输出，未知即显示未知）。
//  - 「作为 New Task 执行后端」开关：写 Host 侧设置（权威）+ 同步 renderer 侧双门控位。
//  - Recheck（重新探测）/ Connect（启动 documented 登录命令；未配置时给引导，不猜测 CLI 子命令）。
//  - 高级项：可执行入口 / 登录命令 / 状态探针命令 / 超时 / 步数上限。
//
// 计费红线（copy 必须如实）：该后端消耗用户在本机 muse CLI 已完成的订阅登录，
// 不经 OpenRouter、不经 Meta Model API、不创建按量计费 API key。
import { useCallback, useEffect, useState } from "react";
import type { MuseCodeBackendSettings } from "@zcode/shared";
import type { IMuseCodeService, MuseCodeBackendView } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { toast } from "@/components/ui/toast.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  setMuseCodeBackendEnabled,
  setMuseCodeBackendSupported,
} from "@/v4/museCodeBackendState.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

interface MuseCodeSectionProps {
  workspacePath?: string | null;
  workspaceIdentity?: string | null;
}

export function MuseCodeSection({ workspacePath, workspaceIdentity }: MuseCodeSectionProps) {
  const { intl } = useZCodeIntl();
  const { museCodeService } = useServices();
  const [view, setView] = useState<MuseCodeBackendView | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);

  const target =
    workspacePath && workspacePath.trim().length > 0
      ? {
          workspacePath: workspacePath.trim(),
          ...(workspaceIdentity?.trim() ? { workspaceIdentity: workspaceIdentity.trim() } : {}),
        }
      : undefined;

  const applyView = useCallback((next: MuseCodeBackendView) => {
    setView(next);
    setMuseCodeBackendSupported(next.backendSupported && next.status.state === "installed");
  }, []);

  useEffect(() => {
    if (!museCodeService) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    museCodeService
      .getView(target)
      .then((next) => {
        if (!cancelled) applyView(next);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [museCodeService, applyView, target?.workspacePath, target?.workspaceIdentity]);

  const handleRecheck = useCallback(async () => {
    if (!museCodeService) return;
    setRechecking(true);
    try {
      applyView(await museCodeService.recheck(target));
    } catch {
      toast(intl.formatMessage({ id: "settings.museCode.recheckFailed" }));
    } finally {
      setRechecking(false);
    }
  }, [museCodeService, applyView, target, intl]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!museCodeService || !view) return;
      setSavingToggle(true);
      try {
        const settings = await museCodeService.saveSettings({
          ...view.settings,
          useAsTaskBackend: checked,
        });
        // Host 侧设置是权威；renderer 双门控位同步（supported 由本会话能力确认维持）。
        setMuseCodeBackendEnabled(checked);
        setView({ ...view, settings });
      } catch {
        toast(intl.formatMessage({ id: "settings.museCode.saveFailed" }));
      } finally {
        setSavingToggle(false);
      }
    },
    [museCodeService, view, intl],
  );

  const handleConnect = useCallback(async () => {
    if (!museCodeService) return;
    try {
      const result = await museCodeService.launchLogin();
      if (result.launched) {
        toast(intl.formatMessage({ id: "settings.museCode.loginLaunched" }));
      } else if (result.reason === "loginCommandNotConfigured") {
        toast(intl.formatMessage({ id: "settings.museCode.loginCommandNotConfigured" }));
      } else {
        toast(intl.formatMessage({ id: "settings.museCode.loginLaunchFailed" }));
      }
    } catch {
      toast(intl.formatMessage({ id: "settings.museCode.loginLaunchFailed" }));
    }
  }, [museCodeService, intl]);

  if (!museCodeService) {
    return (
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.museCode.title" })}
          description={intl.formatMessage({ id: "settings.museCode.serviceUnavailable" })}
          control={<span />}
        />
      </SettingsGroupCard>
    );
  }

  const status = view?.status;
  const installed = status?.state === "installed";

  return (
    <div className="flex flex-col gap-4" data-testid="muse-code-section">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.museCode.title" })}
          description={intl.formatMessage({ id: "settings.museCode.description" })}
          control={
            <span data-testid="muse-code-status">
              {loading ? (
                <SettingsBadge>
                  {intl.formatMessage({ id: "settings.museCode.checking" })}
                </SettingsBadge>
              ) : installed ? (
                <SettingsBadge>
                  {intl.formatMessage(
                    { id: "settings.museCode.installed" },
                    {
                      version:
                        status?.version ??
                        intl.formatMessage({ id: "settings.museCode.versionUnknown" }),
                    },
                  )}
                </SettingsBadge>
              ) : (
                <SettingsBadge>
                  {intl.formatMessage({ id: "settings.museCode.notInstalled" })}
                </SettingsBadge>
              )}
            </span>
          }
          detail={
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <SettingsBadge>
                  {intl.formatMessage({
                    id:
                      status?.authenticated === true
                        ? "settings.museCode.auth.signedIn"
                        : status?.authenticated === false
                          ? "settings.museCode.auth.signedOut"
                          : "settings.museCode.auth.unknown",
                  })}
                </SettingsBadge>
                <SettingsBadge>
                  {intl.formatMessage({
                    id:
                      status?.contributorMode === true
                        ? "settings.museCode.contributor.on"
                        : status?.contributorMode === false
                          ? "settings.museCode.contributor.off"
                          : "settings.museCode.contributor.unknown",
                  })}
                </SettingsBadge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRecheck}
                  disabled={rechecking}
                  data-testid="muse-code-recheck"
                >
                  {intl.formatMessage({
                    id: rechecking ? "settings.museCode.rechecking" : "settings.museCode.recheck",
                  })}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleConnect}
                  data-testid="muse-code-connect"
                >
                  {intl.formatMessage({ id: "settings.museCode.connect" })}
                </Button>
              </div>
            </div>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.museCode.toggle.title" })}
          description={intl.formatMessage({ id: "settings.museCode.toggle.description" })}
          control={
            <Switch
              checked={view?.settings.useAsTaskBackend === true}
              onCheckedChange={handleToggle}
              disabled={!installed || savingToggle || !view}
              data-testid="muse-code-backend-toggle"
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.museCode.billing.title" })}
          description={intl.formatMessage({ id: "settings.museCode.billing.description" })}
          control={
            <span className="text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "settings.museCode.billing.note" })}
            </span>
          }
        />
      </SettingsGroupCard>
      {view ? <MuseCodeAdvancedSettings service={museCodeService} settings={view.settings} /> : null}
    </div>
  );
}

function MuseCodeAdvancedSettings({
  service,
  settings,
}: {
  service: IMuseCodeService;
  settings: MuseCodeBackendSettings;
}) {
  const { intl } = useZCodeIntl();
  const [executablePath, setExecutablePath] = useState(settings.executablePath ?? "");
  const [loginCommand, setLoginCommand] = useState(settings.loginCommand?.join(" ") ?? "");
  const [statusProbeCommand, setStatusProbeCommand] = useState(
    settings.statusProbeCommand?.join(" ") ?? "",
  );
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    settings.timeoutMs ? String(Math.round(settings.timeoutMs / 60000)) : "",
  );
  const [maxModelSteps, setMaxModelSteps] = useState(
    settings.maxModelSteps ? String(settings.maxModelSteps) : "",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const parsedTimeout = Number.parseInt(timeoutMinutes, 10);
      const parsedSteps = Number.parseInt(maxModelSteps, 10);
      await service.saveSettings({
        useAsTaskBackend: settings.useAsTaskBackend,
        ...(executablePath.trim() ? { executablePath: executablePath.trim() } : {}),
        ...(loginCommand.trim() ? { loginCommand: loginCommand.trim().split(/\s+/) } : {}),
        ...(statusProbeCommand.trim()
          ? { statusProbeCommand: statusProbeCommand.trim().split(/\s+/) }
          : {}),
        ...(Number.isFinite(parsedTimeout) && parsedTimeout > 0
          ? { timeoutMs: parsedTimeout * 60_000 }
          : {}),
        ...(Number.isFinite(parsedSteps) && parsedSteps > 0 ? { maxModelSteps: parsedSteps } : {}),
      });
      toast(intl.formatMessage({ id: "settings.museCode.saved" }));
    } catch {
      toast(intl.formatMessage({ id: "settings.museCode.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [
    service,
    settings.useAsTaskBackend,
    executablePath,
    loginCommand,
    statusProbeCommand,
    timeoutMinutes,
    maxModelSteps,
    intl,
  ]);

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.museCode.advanced.title" })}
        description={intl.formatMessage({ id: "settings.museCode.advanced.description" })}
        control={
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {intl.formatMessage({
              id: saving ? "settings.museCode.saving" : "settings.museCode.advanced.save",
            })}
          </Button>
        }
        controlLayout="wide"
        detail={
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="muse-code-executable-path">
                {intl.formatMessage({ id: "settings.museCode.advanced.executablePath" })}
              </Label>
              <Input
                id="muse-code-executable-path"
                value={executablePath}
                onChange={(event) => setExecutablePath(event.target.value)}
                placeholder="muse"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="muse-code-login-command">
                {intl.formatMessage({ id: "settings.museCode.advanced.loginCommand" })}
              </Label>
              <Input
                id="muse-code-login-command"
                value={loginCommand}
                onChange={(event) => setLoginCommand(event.target.value)}
                placeholder="login"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="muse-code-status-probe">
                {intl.formatMessage({ id: "settings.museCode.advanced.statusProbeCommand" })}
              </Label>
              <Input
                id="muse-code-status-probe"
                value={statusProbeCommand}
                onChange={(event) => setStatusProbeCommand(event.target.value)}
                placeholder="auth status"
              />
            </div>
            <div className="flex flex-row gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="muse-code-timeout">
                  {intl.formatMessage({ id: "settings.museCode.advanced.timeoutMinutes" })}
                </Label>
                <Input
                  id="muse-code-timeout"
                  value={timeoutMinutes}
                  onChange={(event) => setTimeoutMinutes(event.target.value)}
                  inputMode="numeric"
                  placeholder="30"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="muse-code-max-steps">
                  {intl.formatMessage({ id: "settings.museCode.advanced.maxModelSteps" })}
                </Label>
                <Input
                  id="muse-code-max-steps"
                  value={maxModelSteps}
                  onChange={(event) => setMaxModelSteps(event.target.value)}
                  inputMode="numeric"
                  placeholder="200"
                />
              </div>
            </div>
          </div>
        }
      />
    </SettingsGroupCard>
  );
}
