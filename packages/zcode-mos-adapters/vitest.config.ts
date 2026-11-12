import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "zcode-mos-adapters",
    environment: "node",
    setupFiles: [],
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    // 无头沙箱没有 Secret Service：真实凭据存储用环境密钥源（与上游约定一致）。
    env: {
      ZCODE_CREDENTIAL_SECRET: "mos-integration-test-secret-0123456789abcdef0123456789abcdef",
    },
  },
});
