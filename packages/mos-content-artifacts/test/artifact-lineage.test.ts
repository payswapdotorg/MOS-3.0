import { describe, expect, test } from "vitest";
import { artifactSchema } from "@mos/contracts";
import type { Artifact } from "@mos/contracts";
import { lineageAppend, nextVersion } from "../src/index.js";
import { ArtifactVersionConflictError } from "../src/index.js";

/**
 * 版本链纯函数矩阵（domain/artifact-lineage.ts）：
 * nextVersion 恒为 +1；lineageAppend 强制"同 id + 严格 +1 + 血缘逐字携带"
 * （首版本 = version 1 + 空血缘）；违规一律 ArtifactVersionConflictError（fail-closed），
 * 纯函数永不变异输入。
 */

const NOW = "2026-11-13T00:00:00Z";

/** 完整 Artifact 版本记录（与写边界产出物同形，经共享 artifactSchema 校验）。 */
function versionRecord(overrides: Partial<Artifact> = {}): Artifact {
  const record: Artifact = {
    id: "art-1",
    tenant_id: "tenant-acme",
    kind: "draft",
    version: 1,
    content_ref: "content-store/art-1/v1",
    parent_artifact_refs: [],
    transform_id: null,
    created_by: { actor_kind: "human", actor_id: "user-1" },
    provenance: [{ source: "user-upload", observed_at: NOW }],
    rights_status: "unknown",
    quality_status: "unreviewed",
    created_at: NOW,
    ...overrides,
  };
  return artifactSchema.parse(record) as Artifact;
}

describe("nextVersion (版本号由版本链推导，恒为 +1)", () => {
  test("returns previous.version + 1 (v1 -> 2, v3 -> 4)", () => {
    expect(nextVersion(versionRecord({ version: 1 }))).toBe(2);
    expect(nextVersion(versionRecord({ version: 3 }))).toBe(4);
  });
});

describe("lineageAppend (first version: version 1 + empty lineage)", () => {
  test("accepts a first version with version 1 and empty parent refs", () => {
    expect(() => lineageAppend(null, versionRecord())).not.toThrow();
  });

  test("rejects a first version numbered other than 1", () => {
    expect(() => lineageAppend(null, versionRecord({ version: 2 }))).toThrow(
      ArtifactVersionConflictError,
    );
  });

  test("rejects a first version carrying parent refs (matrix: first version lineage must be empty)", () => {
    expect(() =>
      lineageAppend(null, versionRecord({ parent_artifact_refs: ["artifact:root:1"] })),
    ).toThrow(ArtifactVersionConflictError);
  });
});

describe("lineageAppend (next version: same id + strictly +1 + verbatim lineage)", () => {
  test("accepts v2 appended after v1 with the lineage carried verbatim", () => {
    expect(() =>
      lineageAppend(versionRecord({ version: 1 }), versionRecord({ version: 2 })),
    ).not.toThrow();
  });

  test("rejects a version skip (v1 -> v3) with ArtifactVersionConflictError", () => {
    expect(() =>
      lineageAppend(versionRecord({ version: 1 }), versionRecord({ version: 3 })),
    ).toThrow(ArtifactVersionConflictError);
  });

  test("rejects version regression and re-registration (v1 -> v1)", () => {
    expect(() =>
      lineageAppend(versionRecord({ version: 1 }), versionRecord({ version: 1 })),
    ).toThrow(ArtifactVersionConflictError);
  });

  test("rejects a next version from a different artifact id (chain must stay on one artifact)", () => {
    expect(() =>
      lineageAppend(
        versionRecord({ id: "art-1", version: 1 }),
        versionRecord({ id: "art-2", version: 2 }),
      ),
    ).toThrow(ArtifactVersionConflictError);
  });

  test("rejects a lineage mutation attempt (different parent refs) with ArtifactVersionConflictError", () => {
    expect(() =>
      lineageAppend(
        versionRecord({ version: 1, parent_artifact_refs: [] }),
        versionRecord({ version: 2, parent_artifact_refs: ["artifact:other:1"] }),
      ),
    ).toThrow(ArtifactVersionConflictError);
  });

  test("carries a non-empty lineage verbatim when it comes from the previous version", () => {
    const lineage = ["artifact:root:1", "artifact:root:2"];
    expect(() =>
      lineageAppend(
        versionRecord({ version: 2, parent_artifact_refs: [...lineage] }),
        versionRecord({ version: 3, parent_artifact_refs: [...lineage] }),
      ),
    ).not.toThrow();
  });

  test("rejects lineage shrink, growth and reorder as mutations", () => {
    const v2 = versionRecord({
      version: 2,
      parent_artifact_refs: ["artifact:root:1", "artifact:root:2"],
    });
    expect(() =>
      lineageAppend(v2, versionRecord({ version: 3, parent_artifact_refs: ["artifact:root:1"] })),
    ).toThrow(ArtifactVersionConflictError);
    expect(() =>
      lineageAppend(
        v2,
        versionRecord({
          version: 3,
          parent_artifact_refs: ["artifact:root:1", "artifact:root:2", "artifact:root:3"],
        }),
      ),
    ).toThrow(ArtifactVersionConflictError);
    expect(() =>
      lineageAppend(
        v2,
        versionRecord({
          version: 3,
          parent_artifact_refs: ["artifact:root:2", "artifact:root:1"],
        }),
      ),
    ).toThrow(ArtifactVersionConflictError);
  });

  test("never mutates its inputs (pure function)", () => {
    const previous = versionRecord({ version: 1, parent_artifact_refs: [] });
    const next = versionRecord({ version: 2, parent_artifact_refs: [] });
    lineageAppend(previous, next);
    expect(previous.parent_artifact_refs).toEqual([]);
    expect(next.parent_artifact_refs).toEqual([]);
    expect(previous.version).toBe(1);
    expect(next.version).toBe(2);
  });
});
