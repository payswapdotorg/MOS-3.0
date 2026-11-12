/**
 * zcode-mos-adapters 模块登记。
 * requires 仅含 zcode-cli：生产源码零 ZCode 导入（结构化注入），只有集成测试
 * 会 import 真实 ZCode MCP 客户端栈（apps/zcode-cli 子树）来证明端口契约兼容。
 */
export const zcodeMosAdaptersModule = {
  id: "zcode-mos-adapters",
  requires: ["zcode-cli"],
  provides: ["mos-substrate-ports"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { contract: "contract", domain: "domain", app: "application" },
} as const;
