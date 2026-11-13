import { z } from "zod";
import { opaqueIdSchema } from "@mos/contracts";
import type { Mission } from "@mos/contracts";

/**
 * Hypothesis proposal 契约（决策锁 #18：Lab 只提出假设，实验结果归 Experiment authority）。
 *
 * - HypothesisProposal 不含 status / experiment_ref 字段——结果语义在 intake 形状上即不可表达；
 *   创建恒为 status="proposed"、experiment_ref=null（domain/hypothesis.ts 强制）。
 * - mission 存在性经 MissionLookup 端口在写边界判定：端口返回 undefined → MissionNotFoundError。
 */

/**
 * Mission 查找端口：结构化注入（无 provider I/O）。
 * 端口按 (tenantId, missionId) 解析：mission 存在且属于该 tenant 才返回记录，否则 undefined
 * （他租户 mission 与不存在的 mission 同义——fail-closed，不泄露跨租户存在性）。
 * 返回完整 Mission 记录（HypothesisStore 只读取 id/tenant_id；
 * ProgramDiscoveryService 需要完整记录做领域推导）。
 */
export type MissionLookup = (tenantId: string, missionId: string) => Mission | undefined;

/** 假设提案输入：mission 必填；rationale 可空；evidence_refs / proposed_route_ids 未提供 = []。 */
export const hypothesisProposalSchema = z.object({
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema,
  statement: z.string().min(1),
  rationale: z.string().nullable().default(null),
  evidence_refs: z.array(z.string().min(1)).default([]),
  proposed_route_ids: z.array(opaqueIdSchema).default([]),
});
export type HypothesisProposal = z.infer<typeof hypothesisProposalSchema>;

/** 假设写入时引用的 mission 不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测）。 */
export class MissionNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly missionId: string,
  ) {
    super(`mission ${missionId} not found for tenant ${tenantId}`);
    this.name = "MissionNotFoundError";
  }
}

/** 假设引用不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测）。 */
export class HypothesisNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly hypothesisId: string,
  ) {
    super(`hypothesis ${hypothesisId} not found for tenant ${tenantId}`);
    this.name = "HypothesisNotFoundError";
  }
}
