import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "mos-content-artifacts",
    environment: "node",
    setupFiles: [],
    include: ["test/**/*.test.ts"],
  },
});
