import type { MuseExecutionPort } from "@zcode/contracts";
import { selectMuseExecutionSurface } from "@zcode/shared";
import { readMuseCodeBackendSettings } from "./muse-code-settings.js";
import { createMuseExecProcessPort } from "./muse-exec-process.js";
import { createMuseSessionProtocolPort } from "./muse-session-protocol.js";
import { probeMuseCliVersion, resolveMuseExecutableEntry } from "./muse-exec-support.js";
// MuseExecutionPort 装配入口（Issue #24 / ACR-0002；PR #27 评审 R1）：
// 在两个官方执行面之间做运行时选择，选择规则与 Host 侧视图共用（shared
// selectMuseExecutionSurface）：
// - settings.executionSurface 显式值 = 用户知情覆盖（诊断/在机验收）。
// - auto（缺省）：`muse --version` 探针（允许清单环境、进程内缓存、失败不猜测）
//   → CLI 版本与 SDK 锁步 pin **完全一致**（精确配对，rev. 3）→ session-protocol
//   （`muse serve` + @muse-code/sdk）；否则（更新/更旧/版本未知/探针失败/带
//   prerelease 后缀）→ muse-exec（documented `muse exec --json`，所有 CLI 版本
//   可用的 headless 界面）。
// 实际执行面经 result.surface 如实回传 core（归因/日志）。

export function createMuseExecutionPort(
  deps: Parameters<typeof createMuseExecProcessPort>[0] &
    Parameters<typeof createMuseSessionProtocolPort>[0] = {},
): MuseExecutionPort {
  const env = deps.env ?? process.env;
  const readSettings = deps.readSettings ?? readMuseCodeBackendSettings;
  const execPort = createMuseExecProcessPort(deps);
  const mspPort = createMuseSessionProtocolPort(deps);

  return {
    async runMuseExec(request, handlers) {
      const settings = await readSettings(env);
      if (settings.executionSurface === "muse-exec") {
        return execPort.runMuseExec(request, handlers);
      }
      if (settings.executionSurface === "session-protocol") {
        return mspPort.runMuseExec(request, handlers);
      }
      // auto：版本门控。探针失败/版本未知 → 保守回退 exec 面（fail-closed 选择，
      // 绝不猜测版本）。可执行入口缺失时交 exec 面抛出既有的 executableNotFound。
      const executable = resolveMuseExecutableEntry(env, settings, request.executablePath);
      if (!executable) {
        return execPort.runMuseExec(request, handlers);
      }
      const probe = await probeMuseCliVersion(executable, env);
      const surface = selectMuseExecutionSurface({ cliVersion: probe.version, settings });
      return (surface === "session-protocol" ? mspPort : execPort).runMuseExec(request, handlers);
    },
  };
}
