import { z } from "zod";
import { hypothesisStatusSchema } from "./enums.js";
import { opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * ResearchNote / Hypothesis —— core-contracts-v3.0.yaml §objects
 * （Week 2 additive；authority: lab，见 module-registry-v3.0.yaml）。
 *
 * 决策锁 #18：Lab 提出假设与路线；实验定义/证据/结果归 Experiment authority（W3）。
 * 因此 Hypothesis 状态词汇（hypothesisStatusSchema）不含任何结果语义；
 * 实验采纳以不透明 experiment_ref 表达，且只能由 Experiment authority 写入。
 */

/** 研究发现条目：每条发现必须引用一条 Evidence（source+observed_at 已由契约保证）；
 * simulation 类证据永不充当 provider 观测（invariants，守卫见 assertResearchFinding）。 */
export const researchFindingSchema = z.object({
  evidence_ref: z.string().min(1),
  statement: z.string().min(1),
});
export type ResearchFinding = z.infer<typeof researchFindingSchema>;

/** ResearchNote —— 市场研究/证据/想法记录（tenant 范围，逐字 intake、零推断）。 */
export const researchNoteSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  topic: z.string().min(1),
  findings: z.array(researchFindingSchema).default([]),
  insight: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  limitations: z.array(z.string().min(1)).default([]),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type ResearchNote = z.infer<typeof researchNoteSchema>;

/** Hypothesis —— Lab 提出的假设（永不携带实验结果；invariants §15）。 */
export const hypothesisSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema,
  statement: z.string().min(1),
  rationale: z.string().nullable().default(null),
  evidence_refs: z.array(z.string().min(1)).default([]),
  proposed_route_ids: z.array(opaqueIdSchema).default([]),
  status: hypothesisStatusSchema,
  experiment_ref: z.string().nullable().default(null),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;
