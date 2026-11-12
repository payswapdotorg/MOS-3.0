/**
 * mos-extension 模块清单（architecture-governance managed 模块）。
 * 未挂载的 MOS 界面扩展碎片：fail-closed 可用性判定、mission sidecar 的最近一份快照 store、
 * 状态 chip 与注册接缝。层序 domain → app → adapters → components。
 * 组合（挂载进 ZCode 壳层）由 TL 的组合根后续接入；本模块今天不被任何入口 import。
 */
export const mosExtensionModule = {
  id: "mos-extension",
  requires: ["ui"],
  provides: ["mos-extension"],
  publicEntrypoints: ["index.ts", "contract.ts"],
  layers: { domain: "domain", app: "app", adapters: "adapters", components: "components" },
} as const;
