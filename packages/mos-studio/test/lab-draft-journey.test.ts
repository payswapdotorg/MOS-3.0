import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { InMemoryProviderPort } from "@mos/adapters";
import type { TimePort } from "@mos/adapters";
import {
  StudioBriefNotFoundError,
  StudioEvidenceNotFoundError,
  StudioHypothesisNotFoundError,
  StudioNoteNotFoundError,
  StudioService,
  type CredentialStorePort,
  type StudioPorts,
  type StudioSessionContext,
} from "../src/application/studio-service.js";

/**
 * Issue #31 Marketing Lab → Studio draft 旅程（工程层，结构性替身；真实栈证据在
 * test/integration）：授权读 → 证据落地（counts-only + 来源归属）→ 研究记录
 * （facts 必须引用真实证据；insight 独立字段）→ 假设（永不携带实验结果）→
 * 草稿简报（artifact 版本链 + provenance 溯源 + rights 诚实 unknown）→ 复核
 * （append-only review_decision 权利记录 + 下一版本）。负向矩阵：引用不存在、
 * 跨 tenant、无 mission —— 全部 fail-closed 类型化。
 */

class FixedTimePort implements TimePort {
  now(): string {
    return "2026-11-16T12:00:00.000Z";
  }
}

function memoryCredentialStore(initial: Record<string, string> = {}): CredentialStorePort {
  const values = new Map(Object.entries(initial));
  return {
    async save(key, value) {
      values.set(key, value);
    },
    async load(key) {
      return values.get(key) ?? null;
    },
  };
}

function standInSessionFactoryFetch(): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        session_id: "standin-session-1",
        mcp: { type: "http", url: "http://127.0.0.1:9/mcp" },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof globalThis.fetch;
}

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const CONTEXT: StudioSessionContext = {
  sessionId: "sess_lab_1",
  workspacePath: "/home/z/project",
  workspaceIdentity: null,
  workspaceKey: "/home/z/project",
};

const OTHER_CONTEXT: StudioSessionContext = {
  sessionId: "sess_other",
  workspacePath: "/home/z/other",
  workspaceIdentity: null,
  workspaceKey: "/home/z/other",
};

async function newJourney() {
  const directory = await mkdtemp(join(tmpdir(), "mos-lab-journey-"));
  directories.push(directory);
  const provider = new InMemoryProviderPort();
  const ports: StudioPorts = {
    createProviderPort: () => provider,
    credentialStore: memoryCredentialStore(),
    time: new FixedTimePort(),
    fetch: standInSessionFactoryFetch(),
  };
  const service = new StudioService({ dataDir: directory, ports });
  return { directory, provider, ports, service };
}

async function preparedJourney() {
  const journey = await newJourney();
  await journey.service.setOperator({ userId: "operator@example.test", organizationId: null });
  await journey.service.connectComposio(CONTEXT, { apiKey: "standin-key-material" });
  return journey;
}

async function captureEvidence(
  service: StudioService,
  provider: InMemoryProviderPort,
): Promise<string> {
  provider.registerTool({
    serverName: "composio-session",
    toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
    respond: () => ({
      content: [{ type: "text", text: "ok" }],
      isError: false,
      structuredContent: {
        successful: true,
        hits: [{ id: "hit-1", SECRET_RECORD_VALUE: "RECORD_VALUE_MARKER_1" }],
      },
    }),
  });
  const mission = await service.recordMissionIntake(CONTEXT, {
    objective_verbatim: "Grow the PaySwap newsletter 20% in Q1 2027",
  });
  const outcome = await service.executeAuthorizedRead(CONTEXT, {
    query: "newsletter growth",
  });
  if (outcome.status !== "succeeded" || !outcome.evidence_id) {
    throw new Error(`expected succeeded read with evidence id, got ${outcome.status}`);
  }
  return mission.id;
}

describe("authorized read lands as tenant-scoped evidence", () => {
  test("succeeded read returns evidence_id and lists as source-attributed record (counts-only)", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidence = await service.listEvidence(CONTEXT);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe("provider_response");
    expect(evidence[0]?.query).toBe("newsletter growth");
    expect(evidence[0]?.observed_via).toBe("composio-session-mcp");
    expect(evidence[0]?.mission_id).toBe((await service.linkedMission(CONTEXT))?.id ?? null);
    // counts-only：记录值绝不进入证据存储
    expect(JSON.stringify(evidence)).not.toContain("RECORD_VALUE_MARKER");
  });

  test("evidence persists across a restart (new service instance, same data dir)", async () => {
    const { directory, provider, ports, service } = await preparedJourney();
    await captureEvidence(service, provider);
    const restarted = new StudioService({ dataDir: directory, ports });
    const evidence = await restarted.listEvidence(CONTEXT);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.query).toBe("newsletter growth");
  });

  test("another tenant sees no evidence (cross-tenant invisibility)", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    await service.setOperator({ userId: "operator@example.test", organizationId: null });
    // OTHER_CONTEXT 是另一 workspace tenant（operator 已声明，tenant 可解析）
    const other = await service.listEvidence(OTHER_CONTEXT);
    expect(other).toHaveLength(0);
  });
});

describe("research notes (facts must cite real evidence; insight stays separate)", () => {
  test("note with an evidence-backed finding + separate insight is stored and listed", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    const note = await service.recordResearchNote(CONTEXT, {
      topic: "HN discussion sentiment on newsletter growth",
      findings: [{ evidence_ref: evidenceId, statement: "3 posts discussed newsletter growth tactics" }],
      insight: "Organic HN discussion may be a viable awareness route",
    });
    expect(note.findings).toHaveLength(1);
    expect(note.findings[0]?.evidence_ref).toBe(evidenceId);
    expect(note.insight).toBe("Organic HN discussion may be a viable awareness route");
    const listed = await service.listResearchNotes(CONTEXT);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.mission_id).toBe((await service.linkedMission(CONTEXT))?.id ?? null);
  });

  test("finding referencing nonexistent evidence fails closed (typed error)", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    await expect(
      service.recordResearchNote(CONTEXT, {
        topic: "topic",
        findings: [{ evidence_ref: "evidence-does-not-exist", statement: "unsupported" }],
      }),
    ).rejects.toThrow();
  });

  test("note without findings is allowed (topic + insight only)", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    const note = await service.recordResearchNote(CONTEXT, {
      topic: "market observations",
      insight: "no evidence captured yet",
    });
    expect(note.findings).toHaveLength(0);
  });

  test("research notes persist across restart", async () => {
    const { directory, provider, ports, service } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    await service.recordResearchNote(CONTEXT, {
      topic: "topic",
      findings: [{ evidence_ref: evidenceId, statement: "statement" }],
    });
    const restarted = new StudioService({ dataDir: directory, ports });
    expect(await restarted.listResearchNotes(CONTEXT)).toHaveLength(1);
  });
});

describe("hypotheses (never carry experiment outcomes)", () => {
  test("hypothesis for the linked mission is proposed and listed with status proposed", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    const hypothesis = await service.proposeHypothesis(CONTEXT, {
      statement: "Weekly HN launch posts will drive newsletter signups",
      rationale: "Evidence shows active discussion of newsletter tactics",
    });
    expect(hypothesis.status).toBe("proposed");
    const listed = await service.listHypotheses(CONTEXT);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.mission_id).toBe((await service.linkedMission(CONTEXT))?.id);
  });

  test("no mission (explicit unknown id) fails closed", async () => {
    const { service } = await preparedJourney();
    await expect(
      service.proposeHypothesis(CONTEXT, {
        statement: "statement",
        mission_id: "mos-mission-does-not-exist",
      }),
    ).rejects.toThrow();
  });

  test("another tenant's hypotheses are invisible; hypotheses persist across restart", async () => {
    const { directory, ports, service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    await service.proposeHypothesis(CONTEXT, { statement: "statement" });
    const restarted = new StudioService({ dataDir: directory, ports });
    expect(await restarted.listHypotheses(CONTEXT)).toHaveLength(1);
    // 另一 workspace 租户不可见（operator 已声明）
    expect(await restarted.listHypotheses(OTHER_CONTEXT)).toHaveLength(0);
  });
});

describe("Studio draft briefs (artifact lineage + honest rights + review)", () => {
  test("compose registers artifact v1 (unreviewed, rights unknown) with mission + evidence provenance and a route snapshot", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    const brief = await service.composeDraftBrief(CONTEXT, {
      title: "Q1 newsletter growth brief",
      summary: "Launch a weekly HN presence and measure newsletter signups over 8 weeks.",
      evidence_refs: [evidenceId],
    });
    expect(brief.artifact.version).toBe(1);
    expect(brief.artifact.quality_status).toBe("unreviewed");
    expect(brief.artifact.rights_status).toBe("unknown");
    expect(brief.evidence_refs).toEqual([evidenceId]);
    expect(brief.route_summary).not.toBeNull();
    expect(brief.review).toBeNull();
    const listed = await service.listDraftBriefs(CONTEXT);
    expect(listed).toHaveLength(1);
  });

  test("compose with a dangling evidence ref fails closed (typed error)", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    await expect(
      service.composeDraftBrief(CONTEXT, {
        title: "t",
        summary: "s",
        evidence_refs: ["evidence-does-not-exist"],
      }),
    ).rejects.toThrow(StudioEvidenceNotFoundError);
  });

  test("compose with a dangling research note id fails closed (typed error)", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    await expect(
      service.composeDraftBrief(CONTEXT, {
        title: "t",
        summary: "s",
        research_note_ids: ["mos-note-does-not-exist"],
      }),
    ).rejects.toThrow(StudioNoteNotFoundError);
  });

  test("compose with a dangling hypothesis id fails closed (typed error)", async () => {
    const { service } = await preparedJourney();
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    await expect(
      service.composeDraftBrief(CONTEXT, {
        title: "t",
        summary: "s",
        hypothesis_ids: ["mos-hypothesis-does-not-exist"],
      }),
    ).rejects.toThrow(StudioHypothesisNotFoundError);
  });

  test("review approve appends a review_decision rights record and advances the artifact to v2 approved", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    const brief = await service.composeDraftBrief(CONTEXT, {
      title: "t",
      summary: "s",
      evidence_refs: [evidenceId],
    });
    const reviewed = await service.reviewDraftBrief(CONTEXT, {
      brief_id: brief.id,
      decision: "approved",
    });
    expect(reviewed.artifact.version).toBe(2);
    expect(reviewed.artifact.quality_status).toBe("approved");
    expect(reviewed.review?.decision).toBe("approved");
    expect(reviewed.review?.decided_at).toBe("2026-11-16T12:00:00.000Z");

    const listed = await service.listDraftBriefs(CONTEXT);
    expect(listed[0]?.artifact.version).toBe(2);
    expect(listed[0]?.review?.decision).toBe("approved");
    expect(listed[0]?.artifact.rights_status).toBe("unknown");
  });

  test("review of an unknown brief fails closed (typed error)", async () => {
    const { service } = await preparedJourney();
    await expect(
      service.reviewDraftBrief(CONTEXT, { brief_id: "mos-brief-does-not-exist", decision: "approved" }),
    ).rejects.toThrow(StudioBriefNotFoundError);
  });

  test("briefs and reviews persist across restart; another tenant sees nothing", async () => {
    const { directory, provider, ports, service } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    const brief = await service.composeDraftBrief(CONTEXT, {
      title: "t",
      summary: "s",
      evidence_refs: [evidenceId],
    });
    await service.reviewDraftBrief(CONTEXT, { brief_id: brief.id, decision: "rejected" });
    const restarted = new StudioService({ dataDir: directory, ports });
    const listed = await restarted.listDraftBriefs(CONTEXT);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.review?.decision).toBe("rejected");
    expect(listed[0]?.artifact.quality_status).toBe("rejected");
    expect(await restarted.listDraftBriefs(OTHER_CONTEXT)).toHaveLength(0);
  });
});

describe("facts and hypotheses are structurally distinguishable", () => {
  test("notes carry evidence-cited findings; hypotheses carry status and never experiment results", async () => {
    const { service, provider } = await preparedJourney();
    await captureEvidence(service, provider);
    const evidenceId = (await service.listEvidence(CONTEXT))[0]!.id;
    await service.recordMissionIntake(CONTEXT, { objective_verbatim: "objective" });
    const note = await service.recordResearchNote(CONTEXT, {
      topic: "topic",
      findings: [{ evidence_ref: evidenceId, statement: "fact statement" }],
    });
    const hypothesis = await service.proposeHypothesis(CONTEXT, {
      statement: "hypothesis statement",
    });
    // 事实：finding 引用真实证据；假设：无结果字段（结构上不可表达实验结果）
    expect(note.findings[0]?.evidence_ref).toBe(evidenceId);
    expect(hypothesis.status).toBe("proposed");
    expect(JSON.stringify(hypothesis)).not.toContain("experiment_result");
    expect("experiment_ref" in hypothesis).toBe(false);
  });
});
