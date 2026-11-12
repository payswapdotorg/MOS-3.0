/**
 * Route 词表与公共常量（core-contracts Route.status 是命名枚举；W1 只用 candidate）。
 */

/** W1 候选路由状态：评估产物一律 candidate（ready_for_approval 等属后续阶段，additive 演化）。 */
export const ROUTE_STATUS_CANDIDATE = "candidate" as const;

/**
 * 既有 ZCode 权限绑定名（与 @mos/capabilities 描述符 permissionMode 同值）。
 * MOS 不建第二权限系统：副作用动作只在既有 ZCode 权限审批绑定下执行。
 */
export const ZCODE_EXISTING_PERMISSIONS = "zcode_existing_permissions" as const;

/** 未解析到任何能力实例时的显式 unknown 标记（绝不假装 blocked/existing）。 */
export const NO_CAPABILITY_INSTANCES_RESOLVED = "no_capability_instances_resolved" as const;
