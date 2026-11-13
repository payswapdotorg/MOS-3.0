import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "mos-studio",
    environment: "node",
    setupFiles: [],
    // 工程清单只引用 test/*.test.ts（结构性端口；不依赖 CLI dist）。
    // test/integration/** 依赖 `pnpm --filter @zcode/adapters... build` + `pnpm --filter @mos/studio build`
    // （spawn dist/server.mjs、真实 MCP 客户端与真实凭据存储）——与 @mos/adapters 同约定，仅包内运行。
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    // 无头沙箱没有 Secret Service：真实凭据存储用环境密钥源（与 @mos/adapters 同约定）。
    env: {
      ZCODE_CREDENTIAL_SECRET: "mos-studio-integration-test-secret-0123456789abcdef0123456789abcdef",
    },
  },
});
