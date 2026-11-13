import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { writeOfficialPluginRuntimeManifest } from "../src/app/official-plugin-runtime.js";

describe("official plugin runtime manifest", () => {
  const cleanups: string[] = [];
  const originalEntrypoint = process.argv[1];

  afterEach(async () => {
    process.argv[1] = originalEntrypoint;
    await Promise.all(cleanups.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("does not rewrite an unchanged runtime manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-runtime-manifest-"));
    cleanups.push(root);
    const manifestPath = join(root, ".zcode-plugin", "plugin.json");
    await writeJson(manifestPath, {
      mcpServers: {
        "browser-use": {
          args: [],
          command: "old-node",
        },
      },
      name: "browser-use",
    });
    process.argv[1] = join(root, "zcode.cjs");

    await writeOfficialPluginRuntimeManifest({
      pluginName: "browser-use",
      rootPath: root,
    });
    const expectedContents = await readFile(manifestPath, "utf8");
    const firstStat = await stat(manifestPath);
    await delay(30);

    await writeOfficialPluginRuntimeManifest({
      pluginName: "browser-use",
      rootPath: root,
    });
    const secondStat = await stat(manifestPath);

    expect(await readFile(manifestPath, "utf8")).toBe(expectedContents);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("repairs cached entries from the seed and leaves HTTP servers untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-entry-"));
    cleanups.push(root);
    const manifestPath = join(root, ".zcode-plugin", "plugin.json");
    await writeJson(manifestPath, { mcpServers: { pdf: { command: "node", args: ["wrong.js"] } } });
    process.argv[1] = join(root, "zcode.cjs");
    const remote = { type: "http", url: "https://example.com/mcp" };
    const sourceManifestContents = JSON.stringify({
      mcpServers: {
        pdf: { command: "node", args: ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs", "--flag"] },
        search: remote,
      },
    });
    const input = { pluginName: "pdf", rootPath: root, sourceManifestContents };
    await writeOfficialPluginRuntimeManifest(input);
    const contents = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(contents);
    expect(manifest.mcpServers.pdf.args.slice(-2)).toEqual([
      join(root, "dist/server.mjs"),
      "--flag",
    ]);
    expect(manifest.mcpServers.pdf.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(manifest.mcpServers.search).toEqual(remote);
    await writeOfficialPluginRuntimeManifest(input);
    expect(await readFile(manifestPath, "utf8")).toBe(contents);
  });

  it("keeps invalid mcpServers structural errors fatal", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-runtime-invalid-"));
    cleanups.push(root);
    await writeJson(join(root, ".zcode-plugin", "plugin.json"), {
      mcpServers: "invalid",
      name: "browser-use",
    });
    process.argv[1] = join(root, "zcode.cjs");

    await expect(
      (async () =>
        await writeOfficialPluginRuntimeManifest({
          pluginName: "browser-use",
          rootPath: root,
        }))(),
    ).rejects.toThrow("Official plugin manifest has invalid mcpServers.");
  });

  it("rewrites node command hooks to the packaged runtime and leaves wrappers untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-hook-rewrite-"));
    cleanups.push(root);
    await writeJson(join(root, ".zcode-plugin", "plugin.json"), {
      name: "mos-studio",
      mcpServers: { studio: { command: "node", args: ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"] } },
    });
    const designHook = '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" design-rules';
    await writeJson(join(root, "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                command: 'node "${ZCODE_PLUGIN_ROOT}/dist/hook.mjs"',
                onError: "allow",
                timeoutMs: 5000,
                type: "command",
              },
              { command: designHook, type: "command" },
              { command: 'node "${ZCODE_PLUGIN_ROOT}/dist/hook.mjs" --extra-arg', type: "command" },
            ],
          },
        ],
      },
    });
    process.argv[1] = join(root, "zcode.cjs");

    await writeOfficialPluginRuntimeManifest({
      pluginName: "mos-studio",
      rootPath: root,
    });
    const hooks = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8"));
    const [nodeHook, wrapperHook, argHook] = hooks.hooks.SessionStart[0].hooks;

    // node + 单个插件根脚本 → 重写为打包运行时（Electron Node 模式），${ZCODE_PLUGIN_ROOT} 展开。
    const expectedScript = join(root, "dist", "hook.mjs");
    expect(nodeHook.command).toContain(expectedScript);
    expect(nodeHook.command).toContain(process.execPath);
    expect(nodeHook.command).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(nodeHook.onError).toBe("allow");
    expect(nodeHook.timeoutMs).toBe(5000);
    if (process.platform === "win32") {
      expect(nodeHook.command.startsWith('set "ELECTRON_RUN_AS_NODE=1"&& ')).toBe(true);
    } else {
      expect(nodeHook.command.startsWith("ELECTRON_RUN_AS_NODE=1 ")).toBe(true);
    }
    // run-hook.cmd 包装形态保持原样（design/superpowers 插件）。
    expect(wrapperHook.command).toBe(designHook);
    // 携带额外参数的命令不匹配严格形态，保持原样（显式契约，不做启发式拆参）。
    expect(argHook.command).toBe('node "${ZCODE_PLUGIN_ROOT}/dist/hook.mjs" --extra-arg');

    // 幂等：重写后的命令不再匹配 node 形态，重复执行不改字节。
    const firstContents = await readFile(join(root, "hooks", "hooks.json"), "utf8");
    await writeOfficialPluginRuntimeManifest({ pluginName: "mos-studio", rootPath: root });
    expect(await readFile(join(root, "hooks", "hooks.json"), "utf8")).toBe(firstContents);
  });

  it("leaves hook files untouched when the manifest rewrite is a no-op", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-hook-mtime-"));
    cleanups.push(root);
    await writeJson(join(root, ".zcode-plugin", "plugin.json"), {
      name: "mos-studio",
      mcpServers: { studio: { command: "node", args: ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"] } },
    });
    await writeJson(join(root, "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                command: 'node "${ZCODE_PLUGIN_ROOT}/dist/hook.mjs"',
                type: "command",
              },
            ],
          },
        ],
      },
    });
    process.argv[1] = join(root, "zcode.cjs");
    // 首次 rewrite 落盘 hooks。
    await writeOfficialPluginRuntimeManifest({ pluginName: "mos-studio", rootPath: root });
    const hooksPath = join(root, "hooks", "hooks.json");
    const contents = await readFile(hooksPath, "utf8");
    const firstStat = await stat(hooksPath);
    await delay(30);
    // 第二次：manifest 与 hooks 均无变化 → 两个文件都不能被触碰（mtime 稳定）。
    await writeOfficialPluginRuntimeManifest({ pluginName: "mos-studio", rootPath: root });
    const secondStat = await stat(hooksPath);
    expect(await readFile(hooksPath, "utf8")).toBe(contents);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(path), { recursive: true }));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
