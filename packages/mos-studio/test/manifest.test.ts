import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  STUDIO_PANEL_URI,
  STUDIO_SERVER_NAME,
} from "../src/contract/studio-vocabulary.js";
import {
  studioHooksSchema,
  studioManifestSchema,
  STUDIO_SLOT_IDS,
} from "../src/contract/manifest-mirror.js";
import { mosStudioModule } from "../src/module.js";

/**
 * 清单机器校验（工程层；无 CLI dist 依赖）：
 * - 插件清单只用上游 ZCode 清单 schema 定义的字段（strictObject 拒绝未知字段）；
 * - 面板 surface 的 server 必须是 mcpServers 键；resourceUri 必须 ui://；
 * - slots 只用上游已知插槽 id，target.surface 必须指向已声明 surface；
 * - hooks.json 的 SessionStart 命令指向构建产物 hook.mjs；
 * - module.ts requires 与组合根实际接线的模块一致。
 * 上游真实 loader 的完整校验在 test/integration/plugin-real-stack.test.ts（依赖 dist 构建）。
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

test("plugin manifest parses against the mirrored upstream schema (strict keys)", async () => {
  const raw = JSON.parse(
    await readFile(join(packageRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  );
  const manifest = studioManifestSchema.parse(raw);
  expect(manifest.name).toBe("mos-studio");
  expect(Object.keys(manifest.mcpServers)).toContain(STUDIO_SERVER_NAME);
});

test("surface consistency: server key exists and resourceUri is the panel", async () => {
  const raw = JSON.parse(
    await readFile(join(packageRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  );
  const manifest = studioManifestSchema.parse(raw);
  for (const surface of manifest.ui.surfaces) {
    expect(Object.keys(manifest.mcpServers)).toContain(surface.server);
    expect(surface.resourceUri).toBe(STUDIO_PANEL_URI);
    expect(surface.availability).toBe("session");
  }
});

test("slots reference declared surfaces and known slot ids only", async () => {
  const raw = JSON.parse(
    await readFile(join(packageRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  );
  const manifest = studioManifestSchema.parse(raw);
  const surfaceIds = new Set(manifest.ui.surfaces.map((surface) => surface.id));
  for (const slotId of Object.keys(manifest.slots)) {
    expect(STUDIO_SLOT_IDS).toContain(slotId);
    for (const item of manifest.slots[slotId as keyof typeof manifest.slots] ?? []) {
      expect(surfaceIds.has(item.target.surface)).toBe(true);
    }
  }
  expect(Object.keys(manifest.slots).sort()).toEqual(["nav.primary", "sidePane.launcher"]);
});

test("stdio server command points at the built server bundle", async () => {
  const raw = JSON.parse(
    await readFile(join(packageRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  );
  const manifest = studioManifestSchema.parse(raw);
  const server = manifest.mcpServers[STUDIO_SERVER_NAME];
  expect(server).toBeDefined();
  expect(server?.command).toBe("node");
  expect(server?.args).toEqual(["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"]);
});

test("hooks.json: SessionStart command points at the built hook bundle (onError allow)", async () => {
  const raw = JSON.parse(await readFile(join(packageRoot, "hooks", "hooks.json"), "utf8"));
  const hooks = studioHooksSchema.parse(raw);
  const entry = hooks.hooks.SessionStart[0]?.hooks[0];
  expect(entry?.command).toContain("${ZCODE_PLUGIN_ROOT}/dist/hook.mjs");
  expect(entry?.onError).toBe("allow");
  expect(entry?.timeoutMs).toBeDefined();
});

test("module.ts requires equals the composition-root wiring set", () => {
  expect([...mosStudioModule.requires].sort()).toEqual(
    [
      "mos-capabilities",
      "mos-contracts",
      "mos-identity-bridge",
      "mos-integrations",
      "mos-missions",
      "mos-routes",
      "zcode-cli",
      "zcode-mos-adapters",
    ].sort(),
  );
  expect(mosStudioModule.publicEntrypoints).toEqual(["index.ts", "contract.ts"]);
});
