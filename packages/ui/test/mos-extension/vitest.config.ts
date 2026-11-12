import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * mos-extension 单测的本地运行接缝（临时，TL 接线后可删）：
 * 根 vitest.config.ts 的 engineering project 用显式清单（scripts/engineering-test-files.json）
 * 收录测试文件；在本目录四个用例列入清单之前，根配置的 CLI 过滤捡不到它们
 * （`vitest run <path>` 对不在 include 清单里的文件报 "No test files found"）。
 * 本配置只复刻根配置里影响本目录的部分（@ 别名、node 环境），运行方式：
 * `cd packages/ui && pnpm exec vitest run --config test/mos-extension/vitest.config.ts`。
 */
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
    },
  },
  test: {
    name: "mos-extension",
    environment: "node",
    include: ["*.test.ts"],
  },
});
