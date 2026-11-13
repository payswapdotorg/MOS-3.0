import { z } from "zod";
import { opaqueIdSchema, researchFindingSchema } from "@mos/contracts";
import type { EvidenceKind } from "@mos/contracts";

/**
 * ResearchNote intake 契约（verbatim topic/insight、零推断）。
 *
 * - findings 每条 = { evidence_ref, statement }（researchFindingSchema 复用 core-contracts）；
 * - intake 只做形状校验；evidence 存在性与"simulation 不得充当 provider 观测"的判定
 *   在 ResearchNoteStore 写边界经 EvidenceLookup 端口 + assertResearchFindingEvidence
 *   完成（不变量 §16）——本模块零 provider I/O（决策锁 #8）。
 */

/**
 * Evidence 查找端口：结构化注入（无 provider I/O）。
 * 返回所引用证据的 kind；未解析（引用不存在的 evidence）返回 undefined。
 * tenant 范围约束由注入方（组合根）承担——端口拿到的是已按调用方租户解析的 evidence 视图。
 */
export type EvidenceLookup = (ref: string) => { readonly kind: EvidenceKind } | undefined;

/** 逐字 intake 输入：topic 必填；findings 未提供 = []；可空字段未提供保持 null（绝不填充猜测）。 */
export const researchNoteIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  topic: z.string().min(1),
  findings: z.array(researchFindingSchema).default([]),
  insight: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  limitations: z.array(z.string().min(1)).default([]),
});
export type ResearchNoteIntake = z.infer<typeof researchNoteIntakeSchema>;
