import { parseOrFail, researchNoteSchema } from "@mos/contracts";
import type { ResearchNote } from "@mos/contracts";
import { researchNoteIntakeSchema } from "../contract/research.js";
import type { ResearchNoteIntake } from "../contract/research.js";
import type { ResearchNoteIntakeDeps } from "../contract.js";

/**
 * 逐字 intake → ResearchNote（纯函数，零推断、零 I/O、零 Date/random）。
 *
 * 规则（与 mos-missions missionFromIntake 同纪律）：
 * - topic / insight / findings / limitations / confidence 与调用方提供的完全一致
 *   （标点、大小写与内部空白逐字保存，绝不改写、补全或同义转换）；
 * - mission_id / insight / confidence 未提供时保持 null，findings / limitations 未提供时保持 []；
 * - id / created_at / updated_at 由注入 deps 提供（now 一律经 TimePort）；
 * - 产物经 researchNoteSchema parseOrFail（fail-closed）。
 *
 * 注意：evidence 存在性与非 simulation 判定不在此层——由 ResearchNoteStore 写边界经
 * EvidenceLookup 端口 + assertResearchFindingEvidence 完成（不变量 §16）。
 */
export function researchNoteFromIntake(
  intake: ResearchNoteIntake,
  deps: ResearchNoteIntakeDeps,
): ResearchNote {
  const normalized = parseOrFail(
    "ResearchNoteIntake",
    researchNoteIntakeSchema,
    intake,
  ) as ResearchNoteIntake;

  const note: ResearchNote = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    mission_id: normalized.mission_id,
    topic: normalized.topic,
    findings: normalized.findings.map((finding) => ({ ...finding })),
    insight: normalized.insight,
    confidence: normalized.confidence,
    limitations: [...normalized.limitations],
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail("ResearchNote", researchNoteSchema, note) as ResearchNote;
}
