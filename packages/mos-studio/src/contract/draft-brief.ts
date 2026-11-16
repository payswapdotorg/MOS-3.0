import { z } from "zod";

/**
 * 组合根 Studio 草稿简报记录（Issue #31：Marketing Lab → Studio draft brief）。
 *
 * - 只存引用与逐字输入：evidence_refs / research_note_ids / hypothesis_ids 指向
 *   本组合根（Lab 侧）已落地的记录；绝不内联内容字节（content_ref 是不透明引用）。
 * - artifact_id 指向 mos-content-artifacts 注册的首版 draft artifact（版本链、
 *   溯源 provenance 与 rights/quality 状态由 artifacts authority 持有；
 *   本记录不镜像状态——展示时由组合根实时 join，避免双权威漂移）。
 * - route_summary 是撰写时刻的路由评估快照（counts-only，compareRoutes 的投影），
 *   永不回写、永不重算——历史简报保留撰写时的判断依据。
 * - 读取边界 fail-closed：结构损坏抛 ContractValidationError。
 */

export const draftBriefRecordSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  mission_id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  operator_notes: z.string().nullable(),
  evidence_refs: z.array(z.string().min(1)),
  research_note_ids: z.array(z.string().min(1)),
  hypothesis_ids: z.array(z.string().min(1)),
  route_summary: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string().min(1),
  /** 不透明内容引用（mos-content-artifacts 的 content_ref；指向本组合根的简报载荷）。 */
  content_ref: z.string().min(1),
  artifact_id: z.string().min(1),
});
export type DraftBriefRecord = z.infer<typeof draftBriefRecordSchema>;
