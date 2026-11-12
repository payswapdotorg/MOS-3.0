import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getMosExtensionRegistration,
  registerMosExtension,
  unregisterMosExtension,
} from "@/mos-extension/adapters/registration.js";
import { createMosExtensionStore } from "@/mos-extension/app/mosExtensionStore.js";

// 模块级单注册位：每个用例后清空，保证互不污染。
afterEach(() => {
  unregisterMosExtension();
});

describe("mos-extension 注册接缝", () => {
  test("未注册时 getMosExtensionRegistration 返回 null", () => {
    expect(getMosExtensionRegistration()).toBeNull();
  });

  test("register 后可读到同一 store；dispose 后清空", () => {
    expect(getMosExtensionRegistration()).toBeNull();
    const store = createMosExtensionStore();
    const handle = registerMosExtension({ store });
    const registration = getMosExtensionRegistration();
    expect(registration).not.toBeNull();
    expect(registration?.store).toBe(store);
    expect(registration?.subscribe).toBeNull();
    handle.dispose();
    expect(getMosExtensionRegistration()).toBeNull();
  });

  test("dispose 幂等：重复调用无副作用", () => {
    const handle = registerMosExtension({ store: createMosExtensionStore() });
    handle.dispose();
    handle.dispose();
    expect(getMosExtensionRegistration()).toBeNull();
  });

  test("unregisterMosExtension 清空注册；未注册时调用无副作用", () => {
    expect(getMosExtensionRegistration()).toBeNull();
    unregisterMosExtension();
    expect(getMosExtensionRegistration()).toBeNull();
    registerMosExtension({ store: createMosExtensionStore() });
    expect(getMosExtensionRegistration()).not.toBeNull();
    unregisterMosExtension();
    expect(getMosExtensionRegistration()).toBeNull();
  });

  test("subscribe 在注册时接线、dispose 时退订", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const handle = registerMosExtension({ store: createMosExtensionStore(), subscribe });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(getMosExtensionRegistration()?.subscribe).toBe(subscribe);
    handle.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("重注册替换旧注册并先退旧订阅线", () => {
    const oldUnsubscribe = vi.fn();
    const oldSubscribe = vi.fn(() => oldUnsubscribe);
    const oldStore = createMosExtensionStore();
    registerMosExtension({ store: oldStore, subscribe: oldSubscribe });

    const newStore = createMosExtensionStore();
    registerMosExtension({ store: newStore });
    expect(oldUnsubscribe).toHaveBeenCalledTimes(1);
    const registration = getMosExtensionRegistration();
    expect(registration?.store).toBe(newStore);
  });

  test("unregisterMosExtension 也退订（不只清 Map）", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    registerMosExtension({ store: createMosExtensionStore(), subscribe });
    unregisterMosExtension();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(getMosExtensionRegistration()).toBeNull();
  });

  test("过期句柄不会误删后来的注册", () => {
    const oldHandle = registerMosExtension({ store: createMosExtensionStore() });
    const newStore = createMosExtensionStore();
    registerMosExtension({ store: newStore });
    oldHandle.dispose();
    const registration = getMosExtensionRegistration();
    expect(registration?.store).toBe(newStore);
  });
});
