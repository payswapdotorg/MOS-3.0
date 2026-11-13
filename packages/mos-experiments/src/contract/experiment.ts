import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import {
  experimentOutcomeSchema,
  opaqueIdSchema,
  rfc3339TimestampSchema,
} from "@mos/contracts";
import type { ExperimentStatus } from "@mos/contracts";

/**
 * Experiment 写边界契约（core-contracts §Experiment 的 intake 投影，
 * authority: experiments，见 module-registry-v3.0.yaml 与决策锁 #18）。
 *
 * - 持久记录的权威 schema 是 @mos/contracts 的 experimentSchema（共享契约，
 *   本包不重复定义）；此处只定义创建/转移/收尾输入与状态词表。
 * - 决策锁 #18：Lab simulation 不是实验；本包是实际世界实验的定义、指派、
 *   测量证据与**结果**的唯一 authority —— outcome 只能经 concludeExperiment
 *   （analyzed→concluded，且必须有非空 measurement evidence refs + concluded_at）写入。
 * - 决策锁 #8：本包零 provider I/O —— measurement_evidence_refs 只是不透明证据引用，
 *   测量本身经组合根/Integration adapters 之外的真实世界观测回填。
 */

/** 生命周期词表（与 @mos/contracts experimentStatusSchema 同源；创建恒为 defined）。 */
export const EXPERIMENT_STATUS_DEFINED = "defined" as const;
export const EXPERIMENT_STATUS_ASSIGNED = "assigned" as const;
export const EXPERIMENT_STATUS_MEASURING = "measuring" as const;
export const EXPERIMENT_STATUS_ANALYZED = "analyzed" as const;
export const EXPERIMENT_STATUS_CONCLUDED = "concluded" as const;
export const EXPERIMENT_STATUS_CANCELLED = "cancelled" as const;

/** 创建输入：mission/hypothesis 可空引用（未提供保持 null，缺失绝不猜测）；
 * statement 逐字；design 为自由形状记录（design 内部形状不在此层语义化）。 */
export const experimentInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  hypothesis_id: opaqueIdSchema.nullable().default(null),
  statement: z.string().min(1),
  design: z.record(z.string(), z.unknown()),
});
export type ExperimentInput = z.infer<typeof experimentInputSchema>;

/**
 * 生命周期转移输入（discriminated union；**没有 concluded 变体**——
 * outcome 只能经 concludeExperiment 写入，直接 target=concluded 一律
 * ExperimentTransitionError，见 domain/experiment-lifecycle.ts）。
 * defined→assigned 必须携带 assignment record（指派记录，非 null）。
 */
export const experimentTransitionSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal(EXPERIMENT_STATUS_ASSIGNED),
    assignment: z.record(z.string(), z.unknown()),
  }),
  z.object({ target: z.literal(EXPERIMENT_STATUS_MEASURING) }),
  z.object({ target: z.literal(EXPERIMENT_STATUS_ANALYZED) }),
  z.object({ target: z.literal(EXPERIMENT_STATUS_CANCELLED) }),
]);
export type ExperimentTransitionInput = z.infer<typeof experimentTransitionSchema>;

/**
 * 收尾输入（concludeExperiment 专用）：outcome 必填（experimentOutcome 词表）；
 * evidence_refs 允许空数组进入（shape 校验），但空数组在领域层被
 * OutcomeEvidenceRequiredError 拒绝（无证据不得出结果）；concluded_at 必填。
 */
export const concludeExperimentInputSchema = z.object({
  outcome: experimentOutcomeSchema,
  outcome_note: z.string().nullable().default(null),
  evidence_refs: z.array(z.string().min(1)),
  concluded_at: rfc3339TimestampSchema,
});
export type ConcludeExperimentInput = z.infer<typeof concludeExperimentInputSchema>;

/** 实验不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测；
 * 跨租户访问另由 assertTenantScope 抛 InvariantViolation）。 */
export class ExperimentNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly experimentId: string,
  ) {
    super(`experiment ${experimentId} not found for tenant ${tenantId}`);
    this.name = "ExperimentNotFoundError";
  }
}

/** 实验输入/记录校验失败（fail-closed；ContractValidationError 的类型化投影，绝不静默修正字段）。 */
export class ExperimentValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Experiment", [...issues]);
    this.name = "ExperimentValidationError";
  }
}

/** 非法生命周期转移（fail-closed）：携带具名 current/target，绝不静默改道。 */
export class ExperimentTransitionError extends Error {
  constructor(
    public readonly current: ExperimentStatus,
    public readonly target: ExperimentStatus,
    detail?: string,
  ) {
    super(
      detail === undefined
        ? `illegal experiment transition: ${current} -> ${target}`
        : `illegal experiment transition: ${current} -> ${target} (${detail})`,
    );
    this.name = "ExperimentTransitionError";
  }
}

/**
 * 收尾缺测量证据（决策锁 #18 + 不变量 §21 的具名错误）：
 * outcome 只能伴随非空 measurement evidence refs 写入；missing 携带缺失项名单。
 */
export class OutcomeEvidenceRequiredError extends Error {
  constructor(
    public readonly experimentId: string,
    public readonly missing: readonly string[],
  ) {
    super(
      `experiment ${experimentId} cannot conclude without measurement evidence (missing: ${missing.join(", ")})`,
    );
    this.name = "OutcomeEvidenceRequiredError";
  }
}

/** 假设采纳被拒的具名原因（domain/adoption.ts 的判定矩阵）。 */
export type HypothesisAdoptionReason =
  /** 假设 mission 与实验 mission 不一致（或实验无 mission）。 */
  | "mission_mismatch"
  /** 实验尚未开始（defined）/状态未知，不得采纳假设。 */
  | "experiment_status_invalid"
  /** 假设状态不可采纳（已采纳/withdrawn/unknown；可采纳词表 proposed/superseded 之外）。 */
  | "hypothesis_status_invalid"
  /** 实验已链接另一条假设（hypothesis_id 冲突，绝不静默改链）。 */
  | "experiment_hypothesis_conflict";

/** 假设采纳被拒（fail-closed）：携带具名 reason + 实验/假设 id。 */
export class HypothesisAdoptionError extends Error {
  constructor(
    public readonly reason: HypothesisAdoptionReason,
    public readonly experimentId: string,
    public readonly hypothesisId: string,
    message: string,
  ) {
    super(
      `hypothesis ${hypothesisId} cannot be adopted by experiment ${experimentId} (${reason}): ${message}`,
    );
    this.name = "HypothesisAdoptionError";
  }
}
