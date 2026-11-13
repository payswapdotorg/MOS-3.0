import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 构建插件三件套到 dist/（与 zcode-site-plugin 同构）：
// - server.mjs：MCP server；@mos/* 源码包与纯 JS 依赖打进 bundle；
//   @zcode/*（真实 MCP 客户端 + 凭据存储，含 .node 原生模块链）保持 external ——
//   inline 插件布局（plugins.dirs → 本包目录）下经工作区 node_modules 解析
//   （构建前提 pnpm --filter @zcode/adapters... build；marketplace 复制式打包另需
//   vendor 步骤，本里程碑不做，见 CONTRACT.md 安装形态）；
// - hook.mjs：SessionStart hook 进程（@mos/* 结构性组合，零 ZCode 直接依赖，自包含）；
// - ui/panel.html：面板（脚本内联，体积远低于宿主单次读资源上限）。
// esbuild 不做 typecheck；typecheck:integration 覆盖 src/runtime。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "none",
  // 只把原生 .node 模块链留在 external（凭据存储栈的 @napi-rs/keyring 与 koffi；
  // inline 插件布局下经工作区 node_modules 解析）。@zcode/* 的 src/dist 都打进 bundle：
  // @zcode/shared 等是源码导出（plain node 不能直接运行），@zcode/adapters 的 dist
  // 又会传递 require @zcode/shared 源码 —— 一并编译进 bundle 才是 plain-node 可运行形态。
  external: ["@napi-rs/keyring", "koffi"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
};

await build({
  ...common,
  metafile: true,
  entryPoints: [join(root, "src/runtime/main.ts")],
  outfile: join(dist, "server.mjs"),
});

await build({
  ...common,
  metafile: true,
  entryPoints: [join(root, "src/hook/main-hook.ts")],
  outfile: join(dist, "hook.mjs"),
});

const panel = await build({
  metafile: true,
  entryPoints: [join(root, "src/ui/main.tsx")],
  jsx: "automatic",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const html = (await readFile(join(root, "src/ui/panel.html"), "utf8")).replace(
  "/*__SCRIPT__*/",
  () => panel.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
await writeFile(join(dist, "ui", "panel.html"), html);

console.log("mos-studio dist built: server.mjs, hook.mjs, ui/panel.html");
