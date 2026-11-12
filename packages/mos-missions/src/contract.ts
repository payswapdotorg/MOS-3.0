/**
 * mos-missions 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；本文件不声明接口/类方法（≤300 行）。
 * 注意：与 store/sidecar 装配相关的 class 形状由 src/application/* 声明，
 * 这里只放纯数据形状，保证 contract 层不反向依赖 domain/application。
 */
import type { DomainEvent } from "@mos/contracts";

export type {
  Mission,
  MissionIntake,
  TenantContext,
  DomainEvent,
} from "@mos/contracts";
export type {
  TenantResolution,
  TenantUnavailableReason,
} from "@mos/identity-bridge";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type {
  MissionStatus,
  MissionEventType,
} from "./contract/mission-vocabulary.js";

/** 逐字 intake 的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface MissionFromIntakeDeps {
  readonly now: string;
  readonly id: string;
}

/** append-only 事件监听（组合根注入；把事件落到持久事件流是监听方职责）。 */
export type MissionEventSink = (event: DomainEvent) => void;

/** listMissions 过滤器：按 ZCode 会话引用精确相等匹配（无前缀/通配推断）。 */
export interface MissionListFilter {
  readonly source_zcode_session_id?: string | null;
}

/**
 * 可空 ZCode 会话/任务关联（preservation contract：ZCode 会话仍是消息与通用任务状态的
 * 唯一权威；Mission 只保留引用，引用可置 null，绝不复制会话内容）。
 */
export interface MissionLinkInput {
  readonly sessionId: string | null;
  readonly taskId: string | null;
}

/** sidecar graceful-failure 失败记录（观测用；绝不向 ZCode 任务路径抛出）。 */
export interface MissionSidecarFailure {
  readonly stage: MissionSidecarStage;
  readonly message: string;
}

/** sidecar 内部阶段标记：失败发生在哪个环节（定位 graceful-failure 用）。 */
export type MissionSidecarStage =
  | "resolve_tenant"
  | "find_existing_mission"
  | "persist_mission"
  | "link_session";
