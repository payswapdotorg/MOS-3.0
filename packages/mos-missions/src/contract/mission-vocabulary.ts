/**
 * Mission 词表：core-contracts-v3.0.yaml 把 Mission.status 标为 string（未点名枚举），
 * 本模块按 additive 原则补齐命名值；破坏性变更必须走 ACR + 契约版本 bump。
 * 聚合类型与事件类型是本模块的公共语言（事件经 domainEventSchema 校验后发射）。
 */

/** W1 只有 active；cancelled 等终态属于后续阶段（additive 演化，绝不猜测用户意图）。 */
export const MISSION_STATUS_ACTIVE = "active" as const;
export type MissionStatus = typeof MISSION_STATUS_ACTIVE;

/** 领域事件聚合名（core-contracts §DomainEvent.aggregate_type）。 */
export const MISSION_AGGREGATE_TYPE = "mission" as const;

/** Mission 写边界事件类型：created（首次持久化）、linked（ZCode 会话/任务关联变更）。 */
export const MISSION_EVENT_CREATED = "mission.created" as const;
export const MISSION_EVENT_LINKED = "mission.linked" as const;
export type MissionEventType =
  | typeof MISSION_EVENT_CREATED
  | typeof MISSION_EVENT_LINKED;
