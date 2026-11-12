import type {
  MosMissionStatus,
  MosStatusTone,
  ResolvedAvailability,
} from "@/mos-extension/contract.js";

/**
 * 纯展示映射：可用性结论 + mission 关联状态 → chip 的语气与标签。
 * 可见性决策也在这里（不可见返回 null，组件据此不渲染）；组件层只做图标/颜色映射。
 */

/** resolveMosStatusPresentation 的输入。 */
export interface MosStatusPresentationInput {
  /** null（还没有结论）按不可用处理，chip 不渲染。 */
  availability: ResolvedAvailability | null;
  missionStatus: MosMissionStatus;
}

/** chip 的展示模型。 */
export interface MosStatusPresentation {
  tone: MosStatusTone;
  label: string;
}

// i18n：标签暂为内联 en-US。locale 文案的接线与挂载一起 deferred（组合根接入时统一换
// IntlProvider 的 message id），本阶段不触碰 locale 文件。
const LABEL_CONNECTED = "MOS: on";
const LABEL_IDLE = "MOS: idle";
const LABEL_WARNING = "MOS: error";

/**
 * 可见性 + 语气判定（fail-closed）：
 * - availability 为 null，或 reason 为 unregistered/host_stopped/disabled → 不渲染（null）；
 * - missionStatus 为 "error" → warning（错误证据必须保持可见，即使其余判定不可用）；
 * - available 且 missionStatus 为 "linked" → connected；
 * - 其余（含 no_mission、以及 available 与 missionStatus 不一致的组合）→ idle。
 * 不一致输入一律按最保守的可显示态（idle）处理，绝不显示 connected。
 */
export function resolveMosStatusPresentation(
  input: MosStatusPresentationInput,
): MosStatusPresentation | null {
  const availability = input.availability;
  if (!availability) return null;
  // 可见区间：功能可用，或仅缺 mission 关联（chip 显示 "MOS: idle"）。
  if (availability.available !== true && availability.reason !== "no_mission") return null;
  if (input.missionStatus === "error") return { tone: "warning", label: LABEL_WARNING };
  if (availability.available === true && input.missionStatus === "linked") {
    return { tone: "connected", label: LABEL_CONNECTED };
  }
  return { tone: "idle", label: LABEL_IDLE };
}
