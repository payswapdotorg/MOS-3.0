import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MuseCodeCliStatus } from "@zcode/shared";
import { createMuseCodeService } from "../src/muse-code/museCodeService.js";
// IMuseCodeService 契约测试（Issue #24 / ACR-0002）：
// 探针注入（不 spawn 真实进程）验证状态探测纪律（fail-closed、凭据零接触、未知即未知）、
// 设置持久化与登录命令门控。

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

async function prepareSettingsFile(initial?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "muse-service-test-"));
  cleanups.push(() => rm(dir, { force: true, recursive: true }));
  const path = join(dir, "muse-code-backend.json");
  if (initial !== undefined) {
    await writeFile(path, initial, "utf8");
  }
  return path;
}

function okProbe(stdout: string): () => Promise<never> {
  return async () => {
    throw new Error("probe must not be called");
  };
}
void okProbe;

describe("createMuseCodeService status probing", () => {
  it("reports installed with the parsed version", async () => {
    const settingsPath = await prepareSettingsFile();
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async (_executable, args) => {
        expect(args).toEqual(["--version"]);
        return {
          exitCode: 0,
          stderr: "",
          stdout: "muse version 0.9.2\n",
          timedOut: false,
        };
      },
    });
    const view = await service.getView();
    expect(view.status.state).toBe("installed");
    expect((view.status as MuseCodeCliStatus).version).toBe("0.9.2");
    expect(view.backendSupported).toBe(false);
  });

  it("fails closed as unavailable when the executable cannot start", async () => {
    const settingsPath = await prepareSettingsFile();
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async () => ({
        exitCode: null,
        spawnError: "ENOENT",
        stderr: "",
        stdout: "",
        timedOut: false,
      }),
    });
    const view = await service.recheck();
    expect(view.status.state).toBe("unavailable");
    expect(view.status.probeIssueCode).toBe("executableNotFound");
  });

  it("parses the configured status probe output (JSON) without guessing unknown fields", async () => {
    const settingsPath = await prepareSettingsFile(
      JSON.stringify({
        useAsTaskBackend: false,
        statusProbeCommand: ["muse", "auth", "status"],
      }),
    );
    let call = 0;
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async (_executable, args) => {
        call += 1;
        if (call === 1) {
          return { exitCode: 0, stderr: "", stdout: "muse version 1.0.0", timedOut: false };
        }
        expect(args).toEqual(["auth", "status"]);
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            authenticated: true,
            contributorMode: true,
            planLabel: "Muse Spark Contributor",
          }),
          timedOut: false,
        };
      },
    });
    const view = await service.getView();
    expect(view.status.state).toBe("installed");
    expect(view.status.authenticated).toBe(true);
    expect(view.status.contributorMode).toBe(true);
    expect(view.status.planLabel).toBe("Muse Spark Contributor");
  });

  it("keeps auth and contributor state unknown when no status probe is configured", async () => {
    const settingsPath = await prepareSettingsFile();
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async () => ({ exitCode: 0, stderr: "", stdout: "muse version 1.0.0", timedOut: false }),
    });
    const view = await service.getView();
    expect(view.status.authenticated).toBeUndefined();
    expect(view.status.contributorMode).toBeUndefined();
  });

  it("exposes the execution surface preview with the same selection rule as the port (R1)", async () => {
    const withVersion = async (stdout: string) => {
      const settingsPath = await prepareSettingsFile();
      const service = createMuseCodeService({
        settingsPath,
        runProbe: async () => ({ exitCode: 0, stderr: "", stdout, timedOut: false }),
      });
      return service.getView();
    };
    // 旧 CLI / 版本未知 → muse-exec 回退（fail-closed 选择，不猜测）。
    expect((await withVersion("muse version 1.2.3\n")).executionSurface).toBe("muse-exec");
    expect((await withVersion("muse version unknown-build\n")).executionSurface).toBe("muse-exec");
    // CLI >= SDK 锁步配对版本 → session-protocol（官方 MSP 面）。
    expect((await withVersion("muse version 1.4.20\n")).executionSurface).toBe("session-protocol");
    expect((await withVersion("muse version 2.0.1\n")).executionSurface).toBe("session-protocol");
    // 显式用户覆盖优先（诊断/在机验收）。
    const settingsPath = await prepareSettingsFile(
      JSON.stringify({ useAsTaskBackend: false, executionSurface: "session-protocol" }),
    );
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async () => ({ exitCode: 0, stderr: "", stdout: "muse version 1.2.3", timedOut: false }),
    });
    expect((await service.getView()).executionSurface).toBe("session-protocol");
  });
});

describe("createMuseCodeService settings and login", () => {
  it("persists validated settings and invalidates the status cache", async () => {
    const settingsPath = await prepareSettingsFile();
    let probeCalls = 0;
    const service = createMuseCodeService({
      settingsPath,
      runProbe: async () => {
        probeCalls += 1;
        return { exitCode: 0, stderr: "", stdout: "muse version 1.0.0", timedOut: false };
      },
    });
    await service.getView();
    await service.getView();
    expect(probeCalls).toBe(1);
    await service.saveSettings({ useAsTaskBackend: true, maxModelSteps: 5 });
    await expect(readFile(settingsPath, "utf8")).resolves.toContain("maxModelSteps");
    const next = await service.getView();
    expect(next.settings.useAsTaskBackend).toBe(true);
    // 设置变化后缓存失效：可执行入口可能已换，必须重新探测。
    expect(probeCalls).toBe(2);
    await expect(service.saveSettings({ useAsTaskBackend: false, timeoutMs: -1 })).rejects.toThrow();
  });

  it("gates login launch on the configured documented command", async () => {
    const settingsPath = await prepareSettingsFile();
    const gated = createMuseCodeService({ settingsPath });
    await expect(gated.launchLogin()).resolves.toEqual({
      launched: false,
      reason: "loginCommandNotConfigured",
    });

    const withCommand = createMuseCodeService({
      settingsPath,
      launchDetached: () => true,
    });
    await withCommand.saveSettings({ useAsTaskBackend: false, loginCommand: ["login"] });
    await expect(withCommand.launchLogin()).resolves.toEqual({ launched: true });

    const launchFailure = createMuseCodeService({
      settingsPath,
      launchDetached: () => false,
    });
    await launchFailure.saveSettings({ useAsTaskBackend: false, loginCommand: ["login"] });
    await expect(launchFailure.launchLogin()).resolves.toEqual({
      launched: false,
      reason: "launchFailed",
    });
  });
});
