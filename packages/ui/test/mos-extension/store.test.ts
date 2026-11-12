import { describe, expect, test } from "vitest";
import {
  createMosExtensionStore,
  type MosExtensionState,
} from "@/mos-extension/app/mosExtensionStore.js";

const INITIAL = {
  hostState: null,
  mosEnabled: false,
  missionStatus: "unlinked",
  missionId: null,
  lastError: null,
} as const;

describe("createMosExtensionStore", () => {
  test("初始状态 fail-closed：宿主未知、开关关闭、任务未关联、无 mission、无错误", () => {
    const store = createMosExtensionStore();
    const state = store.getState();
    expect(state.hostState).toBeNull();
    expect(state.mosEnabled).toBe(false);
    expect(state.missionStatus).toBe("unlinked");
    expect(state.missionId).toBeNull();
    expect(state.lastError).toBeNull();
    expect(typeof state.applySnapshot).toBe("function");
    expect(typeof state.reset).toBe("function");
  });

  test("applySnapshot 合并语义：只更新给出的字段，其余保持原值", () => {
    const store = createMosExtensionStore();
    store.getState().applySnapshot({ mosEnabled: true });
    expect(store.getState().mosEnabled).toBe(true);
    expect(store.getState().hostState).toBeNull();
    expect(store.getState().missionStatus).toBe("unlinked");

    store.getState().applySnapshot({
      hostState: "running",
      missionStatus: "linked",
      missionId: "mission-01",
      lastError: null,
    });
    expect(store.getState().hostState).toBe("running");
    expect(store.getState().missionStatus).toBe("linked");
    expect(store.getState().missionId).toBe("mission-01");
    expect(store.getState().mosEnabled).toBe(true);
  });

  test("reset 回到初始数据面（动作保留）", () => {
    const store = createMosExtensionStore();
    store.getState().applySnapshot({
      hostState: "running",
      mosEnabled: true,
      missionStatus: "error",
      missionId: "mission-01",
      lastError: "boom",
    });
    store.getState().reset();
    const state = store.getState();
    expect(state.hostState).toBeNull();
    expect(state.mosEnabled).toBe(false);
    expect(state.missionStatus).toBe("unlinked");
    expect(state.missionId).toBeNull();
    expect(state.lastError).toBeNull();
    expect(typeof state.applySnapshot).toBe("function");
    expect(typeof state.reset).toBe("function");
  });

  test("两个 store 实例互不串扰（工厂模式，无模块级单例）", () => {
    const a = createMosExtensionStore();
    const b = createMosExtensionStore();
    a.getState().applySnapshot({ mosEnabled: true, missionId: "mission-a" });
    b.getState().applySnapshot({ hostState: "running" });
    expect(a.getState().mosEnabled).toBe(true);
    expect(a.getState().missionId).toBe("mission-a");
    expect(a.getState().hostState).toBeNull();
    expect(b.getState().mosEnabled).toBe(false);
    expect(b.getState().hostState).toBe("running");
    b.getState().reset();
    expect(a.getState().mosEnabled).toBe(true);
  });

  test("vanilla store 通知：applySnapshot 触发订阅并给出前后状态", () => {
    const store = createMosExtensionStore();
    const seen: Array<{ next: MosExtensionState; prev: MosExtensionState }> = [];
    const unsubscribe = store.subscribe((next, prev) => {
      seen.push({ next, prev });
    });
    store.getState().applySnapshot({ mosEnabled: true });
    expect(seen).toHaveLength(1);
    const first = seen[0];
    expect(first?.prev.mosEnabled).toBe(false);
    expect(first?.next.mosEnabled).toBe(true);
    unsubscribe();
    store.getState().applySnapshot({ mosEnabled: false });
    expect(seen).toHaveLength(1);
  });

  test("reset 之后 applySnapshot 仍可用（动作未被覆盖）", () => {
    const store = createMosExtensionStore();
    store.getState().reset();
    store.getState().applySnapshot({ missionStatus: "linked" });
    expect(store.getState().missionStatus).toBe("linked");
    expect(INITIAL.missionStatus).toBe("unlinked");
  });
});
