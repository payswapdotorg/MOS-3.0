import { z } from "zod";
import { ContractValidationError, opaqueIdSchema } from "@mos/contracts";
import {
  moneySchema,
  nodeRefSchema,
  offerAcceptanceEvaluatorSchema,
  rfc3339TimestampSchema,
} from "@mos/contracts";
import type { GigStatus, NodeRef, RouteComparison } from "@mos/contracts";

/**
 * mos-resource-network 契约 —— Gig（architecture §8 Human Production Task Package）
 * 的写入词汇与类型化错误。
 *
 * §8 逐字字段：objective / source references / script-brief /
 * capture-or-execution instructions / expected output / consent-rights / evaluator /
 * deadline / budget-reward / expected value of waiting / alternative routes。
 * draft 允许 null；发布门禁（§8 包完整性）与人工指派门禁（§23）见 domain/gig-transitions.ts。
 */

/** Gig 写入口（创建恒为 draft；§8 可空披露在发布门禁处 fail-closed）。 */
export const gigIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  objective: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  script_brief: z.string().min(1),
  capture_or_execution_instructions: z.string().min(1),
  expected_output: z.string().min(1),
  consent_rights: z.array(z.string().min(1)).default([]),
  evaluator: offerAcceptanceEvaluatorSchema,
  deadline: rfc3339TimestampSchema.nullable().default(null),
  budget_reward: moneySchema.nullable().default(null),
  expected_value_of_waiting: moneySchema.nullable().default(null),
  alternative_route_ids: z.array(opaqueIdSchema).default([]),
});
export type GigIntake = z.infer<typeof gigIntakeSchema>;

/** 指派输入：目标节点 + 路线比较（指派给 human 节点时必填并过 §23 门禁）。 */
export const gigAssignmentInputSchema = z.object({
  assigned_node_ref: nodeRefSchema,
  route_comparison: z
    .object({
      compared_options: z.array(z.unknown()),
      recommendation: z.string().min(1),
      evidence_refs: z.array(z.string().min(1)),
      compared_at: rfc3339TimestampSchema,
    })
    .nullable()
    .default(null),
});
export type GigAssignmentInput = z.input<typeof gigAssignmentInputSchema>;

/** 生命周期词表（与 @mos/contracts gigStatusSchema 同源；创建恒为 draft）。 */
export const GIG_STATUS_DRAFT = "draft" as const;
export const GIG_STATUS_PUBLISHED = "published" as const;
export const GIG_STATUS_ASSIGNED = "assigned" as const;
export const GIG_STATUS_IN_PROGRESS = "in_progress" as const;
export const GIG_STATUS_DELIVERED = "delivered" as const;
export const GIG_STATUS_ACCEPTED = "accepted" as const;
export const GIG_STATUS_REJECTED = "rejected" as const;
export const GIG_STATUS_CANCELLED = "cancelled" as const;

/** Gig 不存在（或不在调用方租户内）：类型化错误。 */
export class GigNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly gigId: string,
  ) {
    super(`gig ${gigId} not found for tenant ${tenantId}`);
    this.name = "GigNotFoundError";
  }
}

/** Gig 写入/记录校验失败（ContractValidationError 的类型化投影）。 */
export class GigValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Gig", [...issues]);
    this.name = "GigValidationError";
  }
}

/** 路线比较记录校验失败（比较经 @mos/contracts routeComparisonSchema 物化）。 */
export class RouteComparisonValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("RouteComparison", [...issues]);
    this.name = "RouteComparisonValidationError";
  }
}

/** §8 包完整性缺口：Gig 只能停留在 draft（发布门禁，具名缺失清单）。 */
export class GigPublishBlockedError extends Error {
  constructor(public readonly missingDisclosures: readonly string[]) {
    super(`§8 人工任务包披露缺失，gig 只能停留在 draft（missing: ${missingDisclosures.join(", ")})`);
    this.name = "GigPublishBlockedError";
  }
}

/** §23 人工指派缺口：指派给 human 节点缺路线比较/包披露（具名缺失清单）。 */
export class GigAssignmentBlockedError extends Error {
  constructor(
    public readonly gigId: string,
    public readonly missing: readonly string[],
  ) {
    super(
      `gig ${gigId} 指派给真人缺 §8/§23 必需项（missing: ${missing.join(", ")}）；` +
        "存在 adequate 非人工路线时按 §8 不得默认指派真人",
    );
    this.name = "GigAssignmentBlockedError";
  }
}

/** 非法状态转移（fail-closed）：携带具名 current/target，绝不静默改道。 */
export class GigTransitionError extends Error {
  constructor(
    public readonly current: GigStatus,
    public readonly target: GigStatus,
    detail?: string,
  ) {
    super(
      detail === undefined
        ? `illegal gig transition: ${current} -> ${target}`
        : `illegal gig transition: ${current} -> ${target} (${detail})`,
    );
    this.name = "GigTransitionError";
  }
}

/** 写入依赖（id/now 注入；与 W2/W3 各 store 同约定）。 */
export interface GigCreationDeps {
  readonly id: string;
  readonly now: string;
}

/** 状态转移依赖（时间注入；领域层零 Date/random 依赖）。 */
export interface GigTransitionDeps {
  readonly now: string;
}

/** 指派输入的物化形状（route_comparison 已是合法 RouteComparison 或 null）。 */
export interface GigAssignment {
  readonly assigned_node_ref: NodeRef;
  readonly route_comparison: RouteComparison | null;
}
