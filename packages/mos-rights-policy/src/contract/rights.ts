import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import {
  rightsDecisionSchema,
  rightsRecordSchema,
  rfc3339TimestampSchema,
} from "@mos/contracts";

/**
 * RightsRecord 写边界契约（core-contracts §RightsRecord 的写入投影，authority: rights-policy）。
 *
 * - 写入 kind 词表是共享 rightsKindSchema 的可写子集（W3-A 工作包：
 *   source_license / consent / platform_policy / review_decision）——
 *   "unknown" 是读取侧的未分类词，不是可写入的断言（fail-closed）；
 * - subject_artifact_ref 可空：null = 通配（覆盖该 tenant 全部 artifact），
 *   非 null = 精确覆盖该 artifact 引用；decision / decided_at / expires_at
 *   逐字 intake（pending 决定的 decided_at 允许为 null——绝不猜测决定时间）；
 * - review_decision 追加式（append-only）：已存在记录（同 id）的 decision 不可改，
 *   改变决定必须追加一条新 id 的新记录（store 写边界强制，见 application/rights-store.ts）。
 */

/** 可写入的权利记录种类（共享 rightsKindSchema 的真子集；unknown 只在读取侧存在）。 */
export const RIGHTS_RECORD_WRITABLE_KINDS = [
  "source_license",
  "consent",
  "platform_policy",
  "review_decision",
] as const;
export type RightsRecordWritableKind = (typeof RIGHTS_RECORD_WRITABLE_KINDS)[number];

/** 时间端口（结构化注入）：gate 评估的 now 一律经端口获得（领域层零 Date/random）。 */
export interface TimePort {
  now(): string;
}

/** 权利记录写入输入：id / created_at / updated_at 由注入 deps 提供，不在输入中。 */
export const rightsRecordInputSchema = z.object({
  kind: z.enum(RIGHTS_RECORD_WRITABLE_KINDS),
  subject_ref: z.string().min(1),
  subject_artifact_ref: z.string().min(1).nullable(),
  constraints: z.array(z.string().min(1)),
  evidence_refs: z.array(z.string().min(1)),
  decision: rightsDecisionSchema,
  decided_at: rfc3339TimestampSchema.nullable(),
  expires_at: rfc3339TimestampSchema.nullable(),
});
export type RightsRecordInput = z.infer<typeof rightsRecordInputSchema>;

/**
 * 持久权利记录：共享 rightsRecordSchema 的无默认值投影（文件格式全显式，
 * 缺键即校验失败——读边界绝不静默补全；W2 nodeOfferRecordSchema 同模式）。
 * 收紧：subject_artifact_ref 非 null 时必须是非空字符串。
 */
export const rightsRecordRecordSchema = rightsRecordSchema.extend({
  subject_artifact_ref: z.string().min(1).nullable(),
  decided_at: rfc3339TimestampSchema.nullable(),
  expires_at: rfc3339TimestampSchema.nullable(),
});
export type RightsRecordRecord = z.infer<typeof rightsRecordRecordSchema>;

/** RightsRecord 写边界校验失败（fail-closed；是 ContractValidationError 的类型化投影）。 */
export class RightsValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("RightsRecord", [...issues]);
    this.name = "RightsValidationError";
  }
}

/** 权利记录不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class RightsRecordNotFoundError extends Error {
  constructor(public readonly recordId: string) {
    super(`rights record not found: ${recordId}`);
    this.name = "RightsRecordNotFoundError";
  }
}
