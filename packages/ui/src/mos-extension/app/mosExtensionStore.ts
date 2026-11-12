import { createStore, type StoreApi } from "zustand";
import type {
  MosExtensionData,
  MosExtensionSnapshot,
} from "@/mos-extension/contract.js";

/**
 * mission sidecar 的 Renderer 侧 store：只持「最近一份快照」的数据面，不做订阅、不做 IO；
 * 喂数据（applySnapshot）与接线（subscribe）都由组合根在注册接缝上完成。
 * 工厂模式：不提供模块级单例，组合根与测试各自建实例，互不串扰。
 */

/** store 状态 = 数据面 + 两个动作（动作也在状态里，vanilla store 的惯用形态）。 */
export interface MosExtensionState extends MosExtensionData {
  /** 合并式更新：只允许数据字段，未给出的字段保持原值。 */
  applySnapshot(partial: MosExtensionSnapshot): void;
  /** 回到初始数据面（宿主未知、开关关闭、任务未关联）。 */
  reset(): void;
}

/** 一个 mission sidecar 的 vanilla store 实例。 */
export type MosExtensionStore = StoreApi<MosExtensionState>;

const INITIAL_DATA: MosExtensionData = {
  hostState: null,
  mosEnabled: false,
  missionStatus: "unlinked",
  missionId: null,
  lastError: null,
};

/** 建一个独立的 sidecar store 实例（初始即 fail-closed：未知宿主、开关关闭、任务未关联）。 */
export function createMosExtensionStore(): MosExtensionStore {
  return createStore<MosExtensionState>((set) => ({
    ...INITIAL_DATA,
    applySnapshot: (partial: MosExtensionSnapshot) => {
      set(partial);
    },
    reset: () => {
      set({ ...INITIAL_DATA });
    },
  }));
}
