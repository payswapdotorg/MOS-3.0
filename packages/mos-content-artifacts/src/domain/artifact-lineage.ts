import { assertArtifactLineageImmutability } from "@mos/contracts";
import type { Artifact } from "@mos/contracts";
import { ArtifactVersionConflictError } from "../contract/artifact.js";

/**
 * 版本链纯函数（零 I/O、零 Date/random；fail-closed，绝不静默修正）。
 *
 * 语义（工作包 W3-A + 不变量 §7"Artifact 版本与父系血缘不可变"）：
 * - 版本 N 只能从同一 artifact id 的父版本 N-1 创建（nextVersion 恒为
 *   previous.version + 1；跳级/回退由 lineageAppend 拒绝）；
 * - parent_artifact_refs 是 artifact 的派生血缘，跨版本逐字携带：
 *   上一版本已发布的血缘不可被后续版本改写（lineageAppend 逐字比对）；
 * - 最终守卫复用 @mos/contracts 的 assertArtifactLineageImmutability
 *   （不变量 §7：版本必须递增 + 血缘必须一致）——领域规则是其严格化
 *   （严格 +1 而非仅递增；具名类型化冲突错误而非 InvariantViolation）。
 */

/**
 * 唯一可创建的下一版本号：previous.version + 1。
 * 版本号永不来自调用方输入——由版本链推导（store 据此构造版本 N）。
 */
export function nextVersion(artifact: Pick<Artifact, "version">): number {
  return artifact.version + 1;
}

/** 两个血缘引用序列是否逐字一致（长度 + 顺序 + 逐元素）。 */
function sameLineage(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((ref, index) => ref === next[index])
  );
}

/**
 * 在版本链上校验追加 next（previous 的下一版本；previous 为 null 表示首版本）：
 *
 * - previous === null（首版本）：next.version 必须为 1 且 parent_artifact_refs
 *   必须为空（首版本没有可引用的父系血缘）；
 * - previous !== null（后续版本）：
 *   1. next.id 必须等于 previous.id——版本 N 只能从同一 artifact id 的
 *      父版本 N-1 创建；
 *   2. next.version 必须等于 previous.version + 1——版本跳级（v1→v3）
 *      与回退/重复一律拒绝；
 *   3. next.parent_artifact_refs 必须逐字等于 previous.parent_artifact_refs
 *      ——"parent refs must equal previous lineage"：已发布版本的父系血缘
 *      不可修改（血缘改写尝试 = 版本冲突）；
 *   4. 最终守卫 assertArtifactLineageImmutability(previous, next)
 *      （不变量 §7，契约层兜底）。
 *
 * 违规抛 ArtifactVersionConflictError（携带冲突原因），绝不静默修正输入。
 */
export function lineageAppend(
  previous: Pick<Artifact, "id" | "version" | "parent_artifact_refs"> | null,
  next: Pick<Artifact, "id" | "version" | "parent_artifact_refs">,
): void {
  if (previous === null) {
    if (next.version !== 1) {
      throw new ArtifactVersionConflictError(
        next.id,
        `首版本必须是 version 1，得到 version ${next.version}`,
      );
    }
    if (next.parent_artifact_refs.length > 0) {
      throw new ArtifactVersionConflictError(
        next.id,
        "首版本的父系血缘必须为空（parent_artifact_refs = []）",
      );
    }
    return;
  }

  if (next.id !== previous.id) {
    throw new ArtifactVersionConflictError(
      next.id,
      `版本只能从同一 artifact id 的父版本创建（父版本为 ${previous.id} v${previous.version}）`,
    );
  }
  if (next.version !== previous.version + 1) {
    throw new ArtifactVersionConflictError(
      next.id,
      `版本跳级：v${previous.version} 之后只允许 v${previous.version + 1}，得到 v${next.version}`,
    );
  }
  if (!sameLineage(previous.parent_artifact_refs, next.parent_artifact_refs)) {
    throw new ArtifactVersionConflictError(
      next.id,
      `父系血缘与上一版本（v${previous.version}）不一致：已发布版本的父系血缘不可修改（invariants §7）`,
    );
  }

  // 契约最终守卫（不变量 §7）：版本必须递增 + 血缘必须一致。
  assertArtifactLineageImmutability(previous, next);
}
