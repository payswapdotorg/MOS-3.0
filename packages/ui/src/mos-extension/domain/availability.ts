import type {
  MosAvailabilityInput,
  ResolvedAvailability,
} from "@/mos-extension/contract.js";

/**
 * fail-closed 可用性判定（纯函数，无 IO）。
 * 判定顺序：宿主服务状态 → MOS 开关 → mission 关联；任何一层不满足都不放行，
 * 未知值（null）与未知组合一律不可用。
 */

/** 未注册（组合根尚未调用 registerMosExtension）时的 fail-closed 常量：一切按不可用渲染。 */
export const unregisteredMosAvailability: ResolvedAvailability = Object.freeze({
  available: false,
  reason: "unregistered",
});

const HOST_STOPPED: ResolvedAvailability = { available: false, reason: "host_stopped" };
const DISABLED: ResolvedAvailability = { available: false, reason: "disabled" };
const NO_MISSION: ResolvedAvailability = { available: false, reason: "no_mission" };
const AVAILABLE: ResolvedAvailability = { available: true, reason: null };

/**
 * 唯一放行组合：serviceState === "running" 且 mosEnabled 且 missionLinked。
 * 其余组合（含 null/未知宿主状态、starting/restarting 中间态）一律不可用：
 * 功能可用需要「宿主在运行 + 开关已开」，mission 关联只影响 chip 显示 idle 与否。
 */
export function resolveMosAvailability(input: MosAvailabilityInput): ResolvedAvailability {
  if (input.serviceState !== "running") return HOST_STOPPED;
  if (!input.mosEnabled) return DISABLED;
  if (!input.missionLinked) return NO_MISSION;
  return AVAILABLE;
}
