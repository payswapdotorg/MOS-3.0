import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StudioService } from "../application/studio-service.js";
import { createStudioServer } from "../server/studio-server.js";
import { createRealStudioPorts } from "./real-stack.js";

/**
 * mos-studio 插件 server 入口（真实栈组合）。
 * 宿主经 stdio 启动（清单 mcpServers.studio：node ${ZCODE_PLUGIN_ROOT}/dist/server.mjs）。
 * $ZCODE_PLUGIN_DATA 由宿主注入（插件 env overlay）；缺失时照常服务但持久化 fail-closed。
 */

export async function main(): Promise<void> {
  // 宿主经 HTTP(S)_PROXY / NO_PROXY 把网络出口配置给子进程；内置 fetch 默认不读，要显式打开。
  (
    http as typeof http & { setGlobalProxyFromEnv?: () => void }
  ).setGlobalProxyFromEnv?.();

  const dist = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = join(dist, "..");
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  ) as { version: string; name: string };
  const panelPath = join(dist, "ui", "panel.html");
  const dataDir = process.env.ZCODE_PLUGIN_DATA?.trim() || null;

  const service = new StudioService({
    dataDir,
    ports: createRealStudioPorts(),
    // 配置缝（非密钥）：默认真实 Composio session 工厂；集成测试经 env 指向本地替身
    // （与 zcode-site resolveRuntimeZCodeEndpointOrigin 的 env 配置同模式）。
    composioSessionFactoryUrl:
      process.env.ZCODE_MOS_COMPOSIO_SESSION_FACTORY_URL?.trim() || undefined,
  });
  const server = createStudioServer({
    service,
    version: manifest.version,
    panelPath: existsSync(panelPath) ? panelPath : null,
  });

  let stopping = false;
  const close = () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  process.stdin.once("end", close);
  await server.connect(new StdioServerTransport());
}

// 保留独立 Node 进程直接启动的用法（与 zcode-site-plugin 同约定）。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
