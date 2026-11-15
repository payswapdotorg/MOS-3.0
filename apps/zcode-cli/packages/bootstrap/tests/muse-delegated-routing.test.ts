import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldRouteMuseDelegatedBySelection } from "../src/zcode-protocol-v4/muse-delegated-routing.js";
// MC-D 按选型路由的决策单元测试（评审 pivot 2026-11-15）：
// - 选型命中 Muse delegated 模型家族（shared isMuseDelegatedModelSelection）且
//   Host 设置 useAsTaskBackend 打开 → 路由委托执行。
// - 普通模型选型 / 免费变体（muse-spark-*-contributor-free）/ 缺选型 → 绝不改道。
// - 设置读取与执行端口/服务同一文件（env 覆盖注入）；读失败/缺文件按缺省
//   false 处理（fail-closed，绝不因设置读失败而静默改道）。
// handler 侧接线（sendText / createSession.firstInput）以同一判定换算
// executionBackend: "muse-code"（信封显式字段路径保持不变）。

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop!()?.().catch(() => undefined);
  }
});

async function settingsFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "muse-routing-test-"));
  cleanups.push(() => rm(dir, { force: true, recursive: true }));
  const path = join(dir, "muse-code-backend.json");
  await writeFile(path, content, "utf8");
  return path;
}

describe("shouldRouteMuseDelegatedBySelection (MC-D 按选型路由)", () => {
  it("routes the existing Composer Contributor selection when the backend is enabled", async () => {
    // 装机确认的既有选型（provider 命名是用户侧自由文本；判定只看 modelId）。
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
        settings: { useAsTaskBackend: true },
      }),
    ).resolves.toBe(true);
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { modelId: "muse-spark-1.4-contributor" },
        settings: { useAsTaskBackend: true },
      }),
    ).resolves.toBe(true);
  });

  it("never routes ordinary or free-variant selections regardless of the toggle", async () => {
    const enabled = { useAsTaskBackend: true };
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "openrouter", modelId: "glm-5.3" },
        settings: enabled,
      }),
    ).resolves.toBe(false);
    // OpenCode Zen 免费变体是显式免费 HTTP 选型，绝不改道到 CLI 订阅。
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "opencode-zen-chat", modelId: "muse-spark-1.2-contributor-free" },
        settings: enabled,
      }),
    ).resolves.toBe(false);
    await expect(
      shouldRouteMuseDelegatedBySelection({ selection: undefined, settings: enabled }),
    ).resolves.toBe(false);
  });

  it("requires the Host opt-in (default off = zero behavior change)", async () => {
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
        settings: { useAsTaskBackend: false },
      }),
    ).resolves.toBe(false);
  });

  it("reads the same settings file the ports read (env override) and honors it", async () => {
    const path = await settingsFile(
      JSON.stringify({ useAsTaskBackend: true, approvalPosture: "fail-closed" }),
    );
    const env = { ZCODE_MUSE_CODE_SETTINGS_FILE: path } as NodeJS.ProcessEnv;
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
        env,
      }),
    ).resolves.toBe(true);
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "openrouter", modelId: "glm-5.3" },
        env,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the settings file is missing or disables the backend", async () => {
    const missing = join(tmpdir(), `muse-routing-missing-${Date.now()}.json`);
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
        env: { ZCODE_MUSE_CODE_SETTINGS_FILE: missing } as NodeJS.ProcessEnv,
      }),
    ).resolves.toBe(false);
    const disabled = await settingsFile(JSON.stringify({ useAsTaskBackend: false }));
    await expect(
      shouldRouteMuseDelegatedBySelection({
        selection: { providerId: "meta", modelId: "muse-spark-1.3-contributor" },
        env: { ZCODE_MUSE_CODE_SETTINGS_FILE: disabled } as NodeJS.ProcessEnv,
      }),
    ).resolves.toBe(false);
  });
});
