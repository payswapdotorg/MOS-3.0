import type { MosExtensionStore } from "@/mos-extension/app/mosExtensionStore.js";

/**
 * 注册接缝：组合根（TL 后续接线）把「store + 可选订阅」登记进来，界面层只从这里读。
 * 未注册（getMosExtensionRegistration() 为 null）时一切按不可用渲染：fail-closed。
 * 这是模块唯一的模块级可变状态；单注册位（Map 固定键），重注册前先退旧线，防泄漏。
 */

/** registerMosExtension 的输入。 */
export interface MosExtensionRegistrationInput {
  store: MosExtensionStore;
  /** 组合根提供的接线函数：注册时调用一次，返回退订函数（dispose/换注册时调用）。 */
  subscribe?: () => () => void;
}

/** 当前注册（组合根之外只读）。 */
export interface MosExtensionRegistration {
  store: MosExtensionStore;
  subscribe: (() => () => void) | null;
}

/** 注册返回的句柄；dispose 幂等，且不会误删后来的新注册。 */
export interface MosExtensionRegistrationHandle {
  dispose(): void;
}

interface RegistrationEntry {
  readonly registration: MosExtensionRegistration;
  unsubscribe: (() => void) | null;
}

// 单注册位：键固定为模块 id。用 Map 保持与接缝语义（可查、可清空）显式化。
const registrations = new Map<string, RegistrationEntry>();
const REGISTRATION_KEY = "mos-extension";

/**
 * 登记 sidecar 注册：先退掉旧注册的订阅线，再把新注册放进去，并立刻接上新订阅。
 * 返回的句柄 dispose 时移除注册并退订；重复 dispose 无副作用。
 */
export function registerMosExtension(
  input: MosExtensionRegistrationInput,
): MosExtensionRegistrationHandle {
  const previous = registrations.get(REGISTRATION_KEY);
  if (previous) {
    registrations.delete(REGISTRATION_KEY);
    previous.unsubscribe?.();
  }
  const unsubscribe = input.subscribe ? input.subscribe() : null;
  const entry: RegistrationEntry = {
    registration: { store: input.store, subscribe: input.subscribe ?? null },
    unsubscribe,
  };
  registrations.set(REGISTRATION_KEY, entry);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      // 只摘自己那次注册；已被替换时不动新注册的线。
      if (registrations.get(REGISTRATION_KEY) !== entry) return;
      registrations.delete(REGISTRATION_KEY);
      unsubscribe?.();
    },
  };
}

/** 清空注册并退订（组合根卸载/测试清理用）；未注册时无副作用。 */
export function unregisterMosExtension(): void {
  const entry = registrations.get(REGISTRATION_KEY);
  if (!entry) return;
  registrations.delete(REGISTRATION_KEY);
  entry.unsubscribe?.();
}

/** 读当前注册；未注册返回 null（一切按不可用渲染）。 */
export function getMosExtensionRegistration(): MosExtensionRegistration | null {
  const entry = registrations.get(REGISTRATION_KEY);
  return entry ? entry.registration : null;
}
