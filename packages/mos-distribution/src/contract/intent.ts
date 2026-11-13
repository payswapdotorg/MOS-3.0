import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import { opaqueIdSchema } from "@mos/contracts";
import type { ApprovalState, DistributionStatus } from "@mos/contracts";

/**
 * DistributionIntent 写边界契约（core-contracts §DistributionIntent 的 intake 投影，
 * authority: distribution，见 module-registry-v3.0.yaml）。
 *
 * - 持久记录的权威 schema 是 @mos/contracts 的 distributionIntentSchema（共享契约，
 *   本包不重复定义）；此处只定义创建输入、预览绑定与状态/审批词表。
 * - 决策锁 #8：本包零 provider I/O —— publish/update/delete 只是意图记录，
 *   真正的 provider 调用归 Integration adapters（组合根在 W1 缝上接线）。
 * - 不变量 §22：副作用型意图进入 executing/succeeded 前必须绑定已批准预览
 *   （assertDistributionPreviewApproval，守卫在 domain/application 写边界调用）。
 */

/** 分发操作词表：只有三种副作用操作（与共享契约 distributionIntentSchema.operation 同源）。 */
export const DISTRIBUTION_OPERATIONS = ["publish", "update", "delete"] as const;
export type DistributionOperation = (typeof DISTRIBUTION_OPERATIONS)[number];

/** 创建输入：operation/connection/capability_instance/artifact 引用 + target 逐字记录；
 * artifact_version 与 idempotency_key 未提供时保持 null（缺失绝不猜测）。 */
export const distributionIntentInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  operation: z.enum(DISTRIBUTION_OPERATIONS),
  connection_id: opaqueIdSchema,
  capability_instance_id: opaqueIdSchema,
  artifact_ref: z.string().min(1),
  artifact_version: z.number().int().min(1).nullable().default(null),
  target: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(1).nullable().default(null),
});
export type DistributionIntentInput = z.infer<typeof distributionIntentInputSchema>;

/** ExternalActionPreview 绑定（不变量 §22）：只携带不透明 preview_ref + preview_hash，
 * 预览记录本身的解析与审批归组合根（经既有 ZCode 权限系统，决策锁 #6）。 */
export const previewBindingSchema = z.object({
  preview_ref: z.string().min(1),
  preview_hash: z.string().min(1),
});
export type PreviewBinding = z.infer<typeof previewBindingSchema>;

/** 生命周期词表（与 @mos/contracts distributionStatusSchema 同源；创建恒为 intent）。 */
export const DISTRIBUTION_STATUS_INTENT = "intent" as const;
export const DISTRIBUTION_STATUS_PREVIEWED = "previewed" as const;
export const DISTRIBUTION_STATUS_PENDING_APPROVAL = "pending_approval" as const;
export const DISTRIBUTION_STATUS_APPROVED = "approved" as const;
export const DISTRIBUTION_STATUS_REJECTED = "rejected" as const;
export const DISTRIBUTION_STATUS_EXECUTING = "executing" as const;
export const DISTRIBUTION_STATUS_SUCCEEDED = "succeeded" as const;
export const DISTRIBUTION_STATUS_FAILED = "failed" as const;

/**
 * 审批状态词表：三种操作全部有副作用（publish/update/delete），
 * 因此创建恒为 pending（绝不写 not_required —— 副作用动作必须绑定既有 ZCode 权限审批，
 * 不变量 §4/§5）；approved/rejected 由 pending_approval→approved/rejected 转移写入。
 */
export const DISTRIBUTION_APPROVAL_PENDING = "pending" as const;
export const DISTRIBUTION_APPROVAL_APPROVED = "approved" as const;
export const DISTRIBUTION_APPROVAL_REJECTED = "rejected" as const;

/** 分发意图不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测；
 * 跨租户访问另由 assertTenantScope 抛 InvariantViolation）。 */
export class IntentNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly intentId: string,
  ) {
    super(`distribution intent ${intentId} not found for tenant ${tenantId}`);
    this.name = "IntentNotFoundError";
  }
}

/** 分发意图输入/记录校验失败（fail-closed；ContractValidationError 的类型化投影，绝不静默修正字段）。 */
export class IntentValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("DistributionIntent", [...issues]);
    this.name = "IntentValidationError";
  }
}

/**
 * 副作用型分发意图在绑定预览前不得推进（不变量 §22 的具名错误之一）：
 * intent→previewed 与 approved→executing 两条边都要求 preview_ref + preview_hash 绑定。
 */
export class PreviewRequiredError extends Error {
  constructor(
    public readonly intentId: string,
    public readonly status: DistributionStatus,
  ) {
    super(
      `intent ${intentId} entering ${status} requires a bound preview (preview_ref + preview_hash, invariants §22)`,
    );
    this.name = "PreviewRequiredError";
  }
}

/**
 * 分发意图在 approval_state=approved 前不得进入 executing（不变量 §22 的具名错误之二）：
 * 审批决定只能经 pending_approval→approved/rejected 转移写入。
 */
export class ApprovalRequiredError extends Error {
  constructor(
    public readonly intentId: string,
    public readonly approvalState: ApprovalState,
  ) {
    super(
      `intent ${intentId} requires approval_state=approved before executing (current approval_state: ${approvalState}, invariants §22)`,
    );
    this.name = "ApprovalRequiredError";
  }
}

/**
 * 幂等键冲突：同一租户内 idempotency_key 已被其他（或同一 id 重试的）意图占用
 * —— 创建失败并具名冲突记录，调用方凭冲突错误查找既有意图，绝不静默重复创建。
 */
export class IdempotencyConflictError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly idempotencyKey: string,
    public readonly existingIntentId: string,
  ) {
    super(
      `idempotency key ${idempotencyKey} already used by intent ${existingIntentId} in tenant ${tenantId}`,
    );
    this.name = "IdempotencyConflictError";
  }
}

/** 非法状态转移（fail-closed）：携带具名 current/target，绝不静默改道。 */
export class IntentTransitionError extends Error {
  constructor(
    public readonly current: DistributionStatus,
    public readonly target: DistributionStatus,
    detail?: string,
  ) {
    super(
      detail === undefined
        ? `illegal distribution intent transition: ${current} -> ${target}`
        : `illegal distribution intent transition: ${current} -> ${target} (${detail})`,
    );
    this.name = "IntentTransitionError";
  }
}
