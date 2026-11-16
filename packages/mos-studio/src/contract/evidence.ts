import { z } from "zod";

/**
 * 组合根证据记录（Issue #31 Marketing Lab）：一次成功授权读的 counts-only 落地。
 *
 * - kind 恒为 provider_response——本存储只由真实授权读路径写入（executeAuthorizedRead
 *   成功分支），绝不写入 simulation/inferred（不变量 §16：research finding 引用的
 *   evidence 必须存在且非 simulation；该判定由 ResearchNoteStore 写边界经
 *   EvidenceLookup 完成，本契约保证存储侧永不出现伪造 kind）。
 * - facts 只承载 counts/shapes 投影（ProviderReadShape + Composio 计数），
 *   绝不承载 provider 记录内容、凭据或授权材料。
 * - query 是操作者的逐字读查询（source attribution 的组成部分），非机密。
 * - 读取边界 fail-closed：结构损坏抛 ContractValidationError，不静默补全。
 */

export const evidenceRecordSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  mission_id: z.string().min(1).nullable(),
  kind: z.literal("provider_response"),
  observed_via: z.string().min(1),
  tool: z.string().min(1),
  connection_id: z.string().min(1),
  session_ref: z.string().min(1),
  observed_at: z.string().min(1),
  query: z.string().min(1),
  facts: z.record(z.string(), z.unknown()),
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
