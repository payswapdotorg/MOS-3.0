import { z } from "zod";
import { ContractValidationError } from "@mos/contracts";
import {
  actorKindSchema,
  artifactKindSchema,
  artifactSchema,
  opaqueIdSchema,
  opaqueRefSchema,
  qualityStatusSchema,
  rightsStatusSchema,
  rfc3339TimestampSchema,
} from "@mos/contracts";

/**
 * Artifact 写边界契约（core-contracts §Artifact 的版本注册投影，authority: artifacts）。
 *
 * - 版本注册输入（ArtifactVersionInput）不含 version / created_at——版本号由版本链
 *   决定（registerFirstVersion 恒为 1；registerNextVersion 恒为上一版本 +1，
 *   见 domain/artifact-lineage.ts），created_at 由注入 deps 提供；
 * - content_ref 只允许不透明引用（opaqueRef：拒绝疑似内联令牌值）——
 *   本包永不保存内容字节（no content bytes in MOS）；
 * - provenance 必填且至少一条（source + observed_at，与不变量 §6
 *   "source-and-observed-at-required-for-external-facts" 同源纪律）；
 * - parent_artifact_refs 逐字 intake：由写边界强制"首版本为空 / 后续版本逐字携带"
 *   （不变量 §7：父系血缘跨版本不可变），绝不静默改写。
 */

/** 版本注册输入：artifact id + 内容引用 + 血缘 + 溯源 + 状态 + 创建者（verbatim intake）。 */
export const artifactVersionInputSchema = z.object({
  id: opaqueIdSchema,
  kind: artifactKindSchema,
  content_ref: opaqueRefSchema,
  parent_artifact_refs: z.array(opaqueRefSchema),
  provenance: z
    .array(
      z.object({
        source: z.string().min(1),
        observed_at: rfc3339TimestampSchema,
      }),
    )
    .min(1),
  rights_status: rightsStatusSchema,
  quality_status: qualityStatusSchema,
  created_by: z.object({
    actor_kind: actorKindSchema,
    actor_id: z.string().min(1),
  }),
});
export type ArtifactVersionInput = z.infer<typeof artifactVersionInputSchema>;

/**
 * 持久 artifact 版本记录：共享 artifactSchema 的无默认值投影（文件格式全显式，
 * 缺键即校验失败——读边界绝不静默补全；W2 nodeOfferRecordSchema 同模式）。
 * 相对共享 schema 的收紧（本存储是唯一写 authority，其文件即写边界产出物）：
 * - parent_artifact_refs / provenance 至少逐字非空字符串；
 * - provenance 必须非空（每条 source 非空 + observed_at RFC3339 UTC）。
 */
export const artifactRecordSchema = artifactSchema.extend({
  parent_artifact_refs: z.array(z.string().min(1)),
  transform_id: z.string().min(1).nullable(),
  provenance: z
    .array(
      z.object({
        source: z.string().min(1),
        observed_at: rfc3339TimestampSchema,
      }),
    )
    .min(1),
});
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

/** Artifact 版本不存在（区别于跨租户访问——后者由 assertTenantScope fail-closed 抛 InvariantViolation）。 */
export class ArtifactNotFoundError extends Error {
  constructor(
    public readonly artifactId: string,
    public readonly version: number | null = null,
  ) {
    super(`artifact not found: ${artifactId}${version === null ? "" : ` v${version}`}`);
    this.name = "ArtifactNotFoundError";
  }
}

/**
 * 版本链冲突（fail-closed，绝不静默修正）：
 * 首版本血缘非空、artifact 已存在、版本跳级（v1→v3）、父系血缘改写
 * （不变量 §7"已发布版本的父系血缘不可修改"的领域投影）都以此类型化错误拒绝。
 */
export class ArtifactVersionConflictError extends Error {
  constructor(
    public readonly artifactId: string,
    public readonly reason: string,
  ) {
    super(`artifact version conflict [${artifactId}]: ${reason}`);
    this.name = "ArtifactVersionConflictError";
  }
}

/** Artifact 写边界校验失败（fail-closed；是 ContractValidationError 的类型化投影）。 */
export class ArtifactValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("Artifact", [...issues]);
    this.name = "ArtifactValidationError";
  }
}
