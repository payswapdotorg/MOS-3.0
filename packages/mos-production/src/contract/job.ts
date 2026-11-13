import { z } from "zod";
import {
  ContractValidationError,
  opaqueIdSchema,
  productionJobStatusSchema,
  rfc3339TimestampSchema,
} from "@mos/contracts";
import type { ProductionGraph } from "@mos/contracts";

/**
 * ProductionJob 写边界契约（core-contracts §ProductionJob；决策锁 #5）。
 *
 * - MOS 只记录持久业务状态：本包【没有】任何启动/运行/执行方法——
 *   zcode_execution_ref 是组合根供给的不透明外部引用（指向 ZCode 侧执行），
 *   linked→executing 只能经外部观测记录（observe），MOS 绝不触发任何执行。
 * - 事件词表：linked（必须携带 zcode_execution_ref + started_at）、
 *   executing（纯外部观测事件）、succeeded（必须携带 completed_at）、
 *   failed（必须携带 failure 说明）、cancelled。
 * - GraphLookup 端口：job 创建要求图存在且 validated——结构化注入，
 *   本包绝不 import 任何其他 @mos/* 模块（组合根负责接线到 GraphStore）。
 */

/** job 事件（判别联合；数据要求在 schema 与领域转移函数双重强制）。 */
export const productionJobEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("linked"),
    zcode_execution_ref: z.string().min(1),
    started_at: rfc3339TimestampSchema,
  }),
  z.object({ kind: z.literal("executing") }),
  z.object({
    kind: z.literal("succeeded"),
    completed_at: rfc3339TimestampSchema,
  }),
  z.object({
    kind: z.literal("failed"),
    failure: z.string().min(1),
  }),
  z.object({ kind: z.literal("cancelled") }),
]);
export type ProductionJobEvent = z.infer<typeof productionJobEventSchema>;

/** job 事件词表（封闭；linked/succeeded/failed/cancelled 为业务事件，executing 为外部观测）。 */
export const PRODUCTION_JOB_EVENT_KINDS = [
  "linked",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type ProductionJobEventKind = (typeof PRODUCTION_JOB_EVENT_KINDS)[number];

/** job 创建输入：引用 graph_id + graph_version（两者都必须指向当前 validated 图）。 */
export const jobCreationInputSchema = z.object({
  graph_id: opaqueIdSchema,
  graph_version: z.number().int().min(1),
});
export type JobCreationInput = z.infer<typeof jobCreationInputSchema>;

/**
 * Graph 查找端口：结构化注入（决策锁 #5/#9——job 创建只引用既有图记录）。
 * 端口按 (tenantId, graphId) 解析：图存在且属于该 tenant 才返回记录，否则 undefined。
 */
export type GraphLookup = (
  tenantId: string,
  graphId: string,
) => ProductionGraph | undefined;

/** job 不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class JobNotFoundError extends Error {
  constructor(public readonly jobId: string) {
    super(`production job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

/** 非法状态转移（fail-closed）：携带当前状态与事件名，绝不静默落到别的状态。 */
export class JobTransitionError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly eventKind: string,
    reason: string,
  ) {
    super(`job transition rejected (${currentStatus} + ${eventKind}): ${reason}`);
    this.name = "JobTransitionError";
  }
}

/**
 * job 创建被拒（fail-closed 门禁）：图未 validated / 版本不匹配 / job id 已存在。
 * W3-B 契约的 additive 类型化错误——错误原因具名（reason），绝不静默换图或换版本。
 */
export class JobCreationBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`job creation blocked: ${reason}`);
    this.name = "JobCreationBlockedError";
  }
}

/** 事件 schema 校验失败（ContractValidationError 的类型化投影，fail-closed）。 */
export class JobEventValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("ProductionJobEvent", [...issues]);
    this.name = "JobEventValidationError";
  }
}

// productionJobStatusSchema 再导出（本包词表锚点；与 @mos/contracts 同源）。
export { productionJobStatusSchema };
