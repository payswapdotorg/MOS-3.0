/**
 * mos-extension 公开契约：类型窄口（不声明方法、不做 IO）。
 * 消费方是未来的组合根（TL 接线）：它建 store、注册接缝、把可用性结论交给 chip。
 * 语义规则（fail-closed 判定顺序宿主 → 开关 → 任务关联）在 domain/availability.ts 实现，
 * 这里只固化调用方必须知道的形状。
 */

/** MOS sidecar 宿主服务的运行状态；null 表示未知/尚无快照（按未运行处理）。 */
export type MosHostServiceState = "starting" | "running" | "stopped" | "restarting";

/** 当前会话与 mission 的关联状态。 */
export type MosMissionStatus = "unlinked" | "linked" | "error";

/** 不可用原因；available=true 时为 null。 */
export type MosUnavailabilityReason = "unregistered" | "host_stopped" | "disabled" | "no_mission";

/** fail-closed 可用性判定的输入（组合根从 store 快照或接缝读出后传入）。 */
export interface MosAvailabilityInput {
  /**
   * 宿主服务状态。null/未知一律按不可用处理；只有 "running" 才可能 available
   * （"starting"/"restarting" 期间也不放行，见 domain/availability.ts）。
   */
  serviceState: MosHostServiceState | null;
  /** MOS 功能开关；false 时不可用（reason "disabled"）。 */
  mosEnabled: boolean;
  /** 是否已关联 mission；false 时 available=false 且 reason "no_mission"（chip 显示 "MOS: idle"）。 */
  missionLinked: boolean;
}

/** 可用性判定结论。 */
export interface ResolvedAvailability {
  available: boolean;
  reason: MosUnavailabilityReason | null;
}

/** chip 的语气；不可见（应返回 null）不进这个枚举。 */
export type MosStatusTone = "connected" | "idle" | "warning";

/** mission sidecar 在 Renderer 的数据面（最近一份快照）；动作定义在 app/mosExtensionStore.ts。 */
export interface MosExtensionData {
  /** sidecar 宿主服务状态；未知为 null。 */
  hostState: MosHostServiceState | null;
  /** MOS 功能开关的最近一份。 */
  mosEnabled: boolean;
  /** mission 关联状态的最近一份。 */
  missionStatus: MosMissionStatus;
  /** 已关联的 mission id；未关联为 null（展示层不得用 null 猜值）。 */
  missionId: string | null;
  /** 最近的错误摘要（不含敏感信息）；无错误为 null。 */
  lastError: string | null;
}

/** applySnapshot 的合并输入：只允许数据字段，全部可选。 */
export interface MosExtensionSnapshot {
  hostState?: MosHostServiceState | null;
  mosEnabled?: boolean;
  missionStatus?: MosMissionStatus;
  missionId?: string | null;
  lastError?: string | null;
}

/** 状态 chip 的 props（纯展示组件；可用性/语气判定都在 domain）。 */
export interface MosStatusChipProps {
  /** 可用性结论；null（还没有结论）按不可用处理，chip 不渲染。 */
  availability: ResolvedAvailability | null;
  missionStatus: MosMissionStatus;
  /** 紧凑态只留图标（文字转 sr-only），由宿主容器在空间不足时传入。 */
  compact?: boolean;
}
