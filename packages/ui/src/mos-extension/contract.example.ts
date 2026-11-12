/**
 * mos-extension 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 全部是函数（不在 import 时执行）；真正的接线属于 TL 的组合根，本示例展示它将使用的最小序列。
 */
import {
  createMosExtensionStore,
  getMosExtensionRegistration,
  registerMosExtension,
  resolveMosAvailability,
  resolveMosStatusPresentation,
  unregisteredMosAvailability,
  type MosExtensionData,
} from "./index.js";

/** 组合根的输入：sidecar 推来的最近一份快照（示例值，en-US 标签阶段同样内联）。 */
export function exampleSnapshot(): MosExtensionData {
  return {
    hostState: "running",
    mosEnabled: true,
    missionStatus: "linked",
    missionId: "mission-01",
    lastError: null,
  };
}

/** 组合根注册 sidecar：建 store、登记接缝、把快照灌进 store，dispose 时整体拆除。 */
export function exampleRegisterMosExtension() {
  const store = createMosExtensionStore();
  const handle = registerMosExtension({
    store,
    // 订阅接线的形状示例：注册时接、退订函数由本方返回。
    subscribe: () => {
      store.getState().applySnapshot(exampleSnapshot());
      return () => {};
    },
  });
  return handle;
}

/** 界面层读注册并算出 chip 要的结论；未注册时用 fail-closed 常量，chip 渲染 null。 */
export function exampleChipModel() {
  const registration = getMosExtensionRegistration();
  if (!registration) {
    return resolveMosStatusPresentation({
      availability: unregisteredMosAvailability,
      missionStatus: "unlinked",
    });
  }
  const state = registration.store.getState();
  return resolveMosStatusPresentation({
    availability: resolveMosAvailability({
      serviceState: state.hostState,
      mosEnabled: state.mosEnabled,
      missionLinked: state.missionStatus === "linked",
    }),
    missionStatus: state.missionStatus,
  });
}
