/**
 * 面板/状态工具的可用性语义 —— 镜像 packages/ui/src/mos-extension 的
 * resolveMosAvailability 门序（host → switch → mission；原因词汇同名）。
 * 镜像而非 import：mos-extension 是宿主树挂载件（挂载仍 deferred），
 * 深导入宿主 ui 包违反治理；语义一致性由 test/availability.test.ts 保证。
 */

export type StudioHostState = "starting" | "running" | "stopped" | "restarting";
export type StudioMissionStatus = "unlinked" | "linked" | "error";

export type StudioUnavailabilityReason =
  | "host_stopped"
  | "disabled"
  | "no_mission"
  | "session_context_unavailable";

export interface StudioAvailabilityInput {
  readonly hostState: StudioHostState;
  /** mos-studio 插件已启用（插件进程在服务即视为启用——不运行则无此代码路径）。 */
  readonly mosEnabled: boolean;
  /** 当前会话已关联 mission。 */
  readonly missionLinked: boolean;
  /** 工具调用携带了会话事实（_meta）；缺失时面板只能显示降级状态。 */
  readonly sessionContextAvailable: boolean;
}

export interface StudioAvailability {
  readonly available: boolean;
  readonly reason: StudioUnavailabilityReason | null;
}

/**
 * 门序与 mos-extension 一致：host stopped → disabled → session 事实 → mission。
 * 只有 running + enabled + 会话事实 + 已关联 mission 才 available。
 */
export function resolveStudioAvailability(input: StudioAvailabilityInput): StudioAvailability {
  if (input.hostState !== "running") return { available: false, reason: "host_stopped" };
  if (!input.mosEnabled) return { available: false, reason: "disabled" };
  if (!input.sessionContextAvailable)
    return { available: false, reason: "session_context_unavailable" };
  if (!input.missionLinked) return { available: false, reason: "no_mission" };
  return { available: true, reason: null };
}

export type StudioStatusTone = "connected" | "idle" | "warning";

export interface StudioStatusPresentation {
  readonly tone: StudioStatusTone;
  readonly label: string;
}

/**
 * 展示规则镜像 resolveMosStatusPresentation 的可见性：仅 available 或
 * no_mission / session_context_unavailable / disabled 可见；mission error 恒可见为 warning；
 * 不一致输入降级为 idle，绝不显示 connected。
 */
export function resolveStudioStatusPresentation(input: {
  availability: StudioAvailability | null;
  missionStatus: StudioMissionStatus;
}): StudioStatusPresentation | null {
  const { availability, missionStatus } = input;
  if (missionStatus === "error") return { tone: "warning", label: "MOS: error" };
  if (!availability) return null;
  if (availability.available) return { tone: "connected", label: "MOS: on" };
  if (availability.reason === "no_mission") return { tone: "idle", label: "MOS: idle" };
  if (availability.reason === "session_context_unavailable")
    return { tone: "idle", label: "MOS: idle" };
  if (availability.reason === "disabled") return { tone: "idle", label: "MOS: idle" };
  return null;
}
