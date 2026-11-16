import { randomUUID } from "node:crypto";
import type { TenantContext, Mission } from "@mos/contracts";
import { CapabilityCatalog, CapabilityInstanceResolverService } from "@mos/capabilities";
import type { ConnectionStore } from "@mos/integrations";
import {
  HypothesisStore,
  ResearchNoteStore,
  researchNoteFromIntake,
} from "@mos/lab";
import type { MissionStore } from "@mos/missions";
import { ArtifactStore, type Artifact } from "@mos/content-artifacts";
import { RightsRecordStore, type RightsRecord } from "@mos/rights-policy";
import { RouteService, compareRoutes, type RouteInstanceFact } from "@mos/routes";
import type { OperatorRecord } from "../contract/operator.js";
import type { EvidenceRecord } from "../contract/evidence.js";
import type { DraftBriefRecord } from "../contract/draft-brief.js";
import {
  draftBriefView,
  evidenceView,
  hypothesisView,
  researchNoteView,
  type DraftBriefReviewView,
  type DraftBriefView,
  type EvidenceView,
  type HypothesisView,
  type ResearchNoteView,
} from "../domain/journey-projection.js";
import { EvidenceStore } from "./evidence-store.js";
import { DraftBriefStore } from "./draft-brief-store.js";
import { STUDIO_COMPOSIO_CAPABILITY_ID, STUDIO_COMPOSIO_IMPLEMENTATION_ID } from "../contract/studio-vocabulary.js";
import type { TimePort } from "@mos/adapters";
import type { StudioSessionContext } from "./studio-shared.js";
import {
  StudioBriefNotFoundError,
  StudioDataDirUnavailableError,
  StudioEvidenceNotFoundError,
  StudioHypothesisNotFoundError,
  StudioMissionNotFoundError,
  StudioNoteNotFoundError,
} from "./studio-shared.js";

/**
 * Issue #31 Marketing Lab → Studio draft 组合（TL 组合根的 Lab/Draft 半区）：
 * 证据落地（授权读成功分支调用 recordCapturedEvidence）→ 研究记录（facts 必须引用
 * 真实证据）→ 假设（永不携带实验结果）→ 草稿简报（content-artifacts 版本链 +
 * provenance 溯源 + rights 诚实 unknown）→ 复核（append-only review_decision 权利记录）。
 *
 * 纪律与 StudioService 相同：所有写入以已解析 tenant 为准（fail-closed）；
 * 证据/简报只承载引用与 counts-only 投影；状态 join 实时读权威（不镜像）。
 */

export interface LabDraftCompositionDeps {
  readonly dataDir: string | null;
  readonly time: TimePort;
  readonly missionStore: MissionStore | null;
  readonly connectionStore: ConnectionStore | null;
  readonly evidenceStore: EvidenceStore | null;
  readonly briefStore: DraftBriefStore | null;
  readonly artifactStore: ArtifactStore | null;
  readonly rightsStore: RightsRecordStore | null;
  readonly catalog: CapabilityCatalog;
  readonly resolver: CapabilityInstanceResolverService;
  readonly routeService: RouteService;
  readonly loadOperator: () => Promise<OperatorRecord | null>;
  readonly linkedMission: (context: StudioSessionContext, tenantId: string) => Promise<Mission | null>;
}

export interface RecordResearchNoteInput {
  readonly topic: string;
  readonly findings?: readonly { evidence_ref: string; statement: string }[];
  readonly insight?: string | null;
  readonly confidence?: number | null;
  readonly limitations?: readonly string[];
  readonly mission_id?: string | null;
}

export interface ProposeHypothesisInput {
  readonly statement: string;
  readonly rationale?: string | null;
  readonly evidence_refs?: readonly string[];
  readonly proposed_route_ids?: readonly string[];
  readonly mission_id?: string;
}

export interface ComposeDraftBriefInput {
  readonly mission_id?: string;
  readonly title: string;
  readonly summary: string;
  readonly operator_notes?: string | null;
  readonly evidence_refs?: readonly string[];
  readonly research_note_ids?: readonly string[];
  readonly hypothesis_ids?: readonly string[];
}

export interface ReviewDraftBriefInput {
  readonly brief_id: string;
  readonly decision: "approved" | "rejected";
  readonly note?: string | null;
}

export interface CapturedEvidencePayload {
  readonly observed_via: string;
  readonly tool: string;
  readonly connection_id: string;
  readonly session_ref: string;
  readonly observed_at: string;
  readonly query: string;
  readonly facts: Record<string, unknown>;
}

export class LabDraftComposition {
  constructor(private readonly deps: LabDraftCompositionDeps) {}

  /** 授权读成功分支（mission 已解析）：证据与 mission 关联落地（组合根唯一写入口）。 */
  recordCapturedEvidenceWithMission(
    tenant: TenantContext,
    missionId: string | null,
    payload: CapturedEvidencePayload,
  ): string | null {
    if (!this.deps.evidenceStore) return null;
    const record: EvidenceRecord = {
      id: `evidence-${randomUUID()}`,
      tenant_id: tenant.tenant_id,
      mission_id: missionId,
      kind: "provider_response",
      ...payload,
    };
    this.deps.evidenceStore.saveEvidence(tenant.tenant_id, record);
    return record.id;
  }

  /** 已落地证据（counts-only 投影；可选按 mission 过滤）。 */
  async listEvidence(
    context: StudioSessionContext,
    tenant: TenantContext,
    missionId?: string,
  ): Promise<readonly EvidenceView[]> {
    if (!this.deps.evidenceStore) throw new StudioDataDirUnavailableError();
    const records = missionId
      ? this.deps.evidenceStore.listEvidenceByMission(tenant.tenant_id, missionId)
      : this.deps.evidenceStore.listEvidence(tenant.tenant_id);
    return records.map(evidenceView);
  }

  /** 逐字研究记录 intake（findings 引用的 evidence 必须存在且非 simulation——Lab 写边界）。 */
  async recordResearchNote(
    context: StudioSessionContext,
    tenant: TenantContext,
    input: RecordResearchNoteInput,
  ): Promise<ResearchNoteView> {
    if (!this.deps.missionStore || !this.deps.evidenceStore) {
      throw new StudioDataDirUnavailableError();
    }
    const missionId =
      input.mission_id !== undefined && input.mission_id !== null
        ? input.mission_id
        : context.sessionId
          ? ((await this.deps.linkedMission(context, tenant.tenant_id))?.id ?? null)
          : null;
    if (missionId && !this.deps.missionStore.getMission(tenant.tenant_id, missionId)) {
      throw new StudioMissionNotFoundError(missionId);
    }
    const now = this.deps.time.now();
    const note = researchNoteFromIntake(
      {
        tenant_id: tenant.tenant_id,
        mission_id: missionId,
        topic: input.topic,
        findings: [...(input.findings ?? [])],
        insight: input.insight ?? null,
        confidence: input.confidence ?? null,
        limitations: [...(input.limitations ?? [])],
      },
      { id: `mos-note-${randomUUID()}`, now },
    );
    // EvidenceLookup 端口按已解析租户视图闭合（组合根承担 tenant 约束——端口契约）。
    const store = new ResearchNoteStore({
      directory: this.requireDataDir(),
      evidenceLookup: (ref) => {
        const found = this.deps.evidenceStore!.getEvidence(tenant.tenant_id, ref);
        return found ? { kind: found.kind } : undefined;
      },
    });
    const saved = store.saveNote(tenant.tenant_id, note);
    return researchNoteView(saved);
  }

  async listResearchNotes(
    tenant: TenantContext,
    missionId?: string,
  ): Promise<readonly ResearchNoteView[]> {
    const store = new ResearchNoteStore({
      directory: this.requireDataDir(),
      evidenceLookup: () => undefined,
    });
    const notes = missionId
      ? store.listNotesByMission(tenant.tenant_id, missionId)
      : store.listNotes(tenant.tenant_id);
    return notes.map(researchNoteView);
  }

  /** 假设提案（决策锁 #18：永不携带实验结果；mission 必须存在）。 */
  async proposeHypothesis(
    context: StudioSessionContext,
    tenant: TenantContext,
    input: ProposeHypothesisInput,
  ): Promise<HypothesisView> {
    if (!this.deps.missionStore) throw new StudioDataDirUnavailableError();
    const mission = await this.resolveMissionArgument(context, tenant.tenant_id, input.mission_id);
    const now = this.deps.time.now();
    const store = new HypothesisStore({
      directory: this.requireDataDir(),
      missionLookup: (lookupTenantId, missionId) =>
        lookupTenantId === tenant.tenant_id
          ? (this.deps.missionStore!.getMission(lookupTenantId, missionId) ?? undefined)
          : undefined,
    });
    const hypothesis = store.proposeHypothesis(
      tenant.tenant_id,
      {
        tenant_id: tenant.tenant_id,
        mission_id: mission.id,
        statement: input.statement,
        rationale: input.rationale ?? null,
        evidence_refs: [...(input.evidence_refs ?? [])],
        proposed_route_ids: [...(input.proposed_route_ids ?? [])],
      },
      { id: `mos-hypothesis-${randomUUID()}`, now },
    );
    return hypothesisView(hypothesis);
  }

  async listHypotheses(
    tenant: TenantContext,
    missionId?: string,
  ): Promise<readonly HypothesisView[]> {
    const store = new HypothesisStore({
      directory: this.requireDataDir(),
      missionLookup: () => undefined,
    });
    const hypotheses = missionId
      ? store.listHypothesesByMission(tenant.tenant_id, missionId)
      : store.listHypotheses(tenant.tenant_id);
    return hypotheses.map(hypothesisView);
  }

  /**
   * 撰写草稿生产简报：校验引用（evidence/notes/hypotheses 均须存在）→ 路由评估快照 →
   * 注册首版 draft artifact（provenance = mission + 证据溯源；rights_status 诚实为
   * unknown——没有权利许可流程绝不声明 cleared；quality_status 起步 unreviewed）。
   */
  async composeDraftBrief(
    context: StudioSessionContext,
    tenant: TenantContext,
    input: ComposeDraftBriefInput,
  ): Promise<DraftBriefView> {
    if (!this.deps.missionStore || !this.deps.evidenceStore || !this.deps.briefStore) {
      throw new StudioDataDirUnavailableError();
    }
    const mission = await this.resolveMissionArgument(context, tenant.tenant_id, input.mission_id);

    const evidenceRefs = [...(input.evidence_refs ?? [])];
    for (const ref of evidenceRefs) {
      if (!this.deps.evidenceStore.getEvidence(tenant.tenant_id, ref)) {
        throw new StudioEvidenceNotFoundError(ref);
      }
    }
    const noteStore = new ResearchNoteStore({
      directory: this.requireDataDir(),
      evidenceLookup: () => undefined,
    });
    const noteIds = [...(input.research_note_ids ?? [])];
    for (const noteId of noteIds) {
      if (!noteStore.getNote(tenant.tenant_id, noteId)) {
        throw new StudioNoteNotFoundError(noteId);
      }
    }
    const hypothesisStore = new HypothesisStore({
      directory: this.requireDataDir(),
      missionLookup: () => undefined,
    });
    const hypothesisIds = [...(input.hypothesis_ids ?? [])];
    for (const hypothesisId of hypothesisIds) {
      if (!hypothesisStore.getHypothesis(tenant.tenant_id, hypothesisId)) {
        throw new StudioHypothesisNotFoundError(hypothesisId);
      }
    }

    // 撰写时刻的路由评估快照（counts-only；与 routes() 同一评估语义，永不重算历史）。
    const routeSummary = await this.routeSnapshotForMission(tenant.tenant_id, mission);

    const briefId = `mos-brief-${randomUUID()}`;
    const artifactId = `mos-artifact-brief-${randomUUID()}`;
    const now = this.deps.time.now();
    const operator = await this.deps.loadOperator();
    const evidenceRecords = evidenceRefs
      .map((ref) => this.deps.evidenceStore!.getEvidence(tenant.tenant_id, ref))
      .filter((record): record is EvidenceRecord => record !== null);
    const artifact = this.requireArtifactStore().registerFirstVersion(
      tenant.tenant_id,
      {
        id: artifactId,
        kind: "draft",
        content_ref: `brief:${briefId}`,
        parent_artifact_refs: [],
        provenance: [
          { source: `mission:${mission.id}`, observed_at: mission.created_at },
          ...evidenceRecords.map((record) => ({
            source: `evidence:${record.id}`,
            observed_at: record.observed_at,
          })),
        ],
        rights_status: "unknown",
        quality_status: "unreviewed",
        created_by: {
          actor_kind: "human",
          actor_id: operator?.userId ?? tenant.actor_id,
        },
      },
      { now },
    );
    const brief: DraftBriefRecord = {
      id: briefId,
      tenant_id: tenant.tenant_id,
      mission_id: mission.id,
      title: input.title,
      summary: input.summary,
      operator_notes: input.operator_notes ?? null,
      evidence_refs: evidenceRefs,
      research_note_ids: noteIds,
      hypothesis_ids: hypothesisIds,
      route_summary: routeSummary,
      created_at: now,
      content_ref: `brief:${briefId}`,
      artifact_id: artifactId,
    };
    this.deps.briefStore.saveBrief(tenant.tenant_id, brief);
    return this.draftBriefProjection(tenant.tenant_id, brief, artifact);
  }

  async listDraftBriefs(
    tenant: TenantContext,
    missionId?: string,
  ): Promise<readonly DraftBriefView[]> {
    if (!this.deps.briefStore) throw new StudioDataDirUnavailableError();
    const briefs = missionId
      ? this.deps.briefStore.listBriefsByMission(tenant.tenant_id, missionId)
      : this.deps.briefStore.listBriefs(tenant.tenant_id);
    return briefs.map((brief) => {
      const artifact = this.requireArtifactStore().latestVersion(tenant.tenant_id, brief.artifact_id);
      return this.draftBriefProjection(tenant.tenant_id, brief, artifact);
    });
  }

  /**
   * 复核草稿简报（人决策）：追加 review_decision 权利记录（append-only）+ 注册下一版
   * artifact（quality_status → approved/rejected；血缘逐字保留；provenance 续接复核来源）。
   */
  async reviewDraftBrief(
    tenant: TenantContext,
    input: ReviewDraftBriefInput,
  ): Promise<DraftBriefView> {
    if (!this.deps.briefStore) throw new StudioDataDirUnavailableError();
    const brief = this.deps.briefStore.getBrief(tenant.tenant_id, input.brief_id);
    if (!brief) throw new StudioBriefNotFoundError(input.brief_id);
    const latest = this.requireArtifactStore().latestVersion(tenant.tenant_id, brief.artifact_id);
    const now = this.deps.time.now();
    const operator = await this.deps.loadOperator();
    const reviewRecordId = `mos-review-${randomUUID()}`;
    this.requireRightsStore().saveRecord(
      tenant.tenant_id,
      {
        kind: "review_decision",
        subject_ref: brief.id,
        subject_artifact_ref: brief.artifact_id,
        constraints: [],
        evidence_refs: [...brief.evidence_refs],
        decision: input.decision === "approved" ? "granted" : "denied",
        decided_at: now,
        expires_at: null,
      },
      { id: reviewRecordId, now },
    );
    const nextArtifact = this.requireArtifactStore().registerNextVersion(
      tenant.tenant_id,
      {
        id: brief.artifact_id,
        kind: latest.kind,
        content_ref: latest.content_ref,
        parent_artifact_refs: [...latest.parent_artifact_refs],
        provenance: [
          ...latest.provenance,
          { source: `review:${reviewRecordId}`, observed_at: now },
        ],
        rights_status: latest.rights_status,
        quality_status: input.decision,
        created_by: {
          actor_kind: "human",
          actor_id: operator?.userId ?? tenant.actor_id,
        },
      },
      { now },
    );
    return this.draftBriefProjection(tenant.tenant_id, brief, nextArtifact);
  }

  private requireDataDir(): string {
    if (!this.deps.dataDir) throw new StudioDataDirUnavailableError();
    return this.deps.dataDir;
  }

  private requireArtifactStore(): ArtifactStore {
    if (!this.deps.artifactStore) throw new StudioDataDirUnavailableError();
    return this.deps.artifactStore;
  }

  private requireRightsStore(): RightsRecordStore {
    if (!this.deps.rightsStore) throw new StudioDataDirUnavailableError();
    return this.deps.rightsStore;
  }

  /** mission 参数解析：显式 id（必须存在）或当前会话关联 mission（否则类型化失败）。 */
  private async resolveMissionArgument(
    context: StudioSessionContext,
    tenantId: string,
    missionId: string | undefined,
  ): Promise<Mission> {
    if (!this.deps.missionStore) throw new StudioDataDirUnavailableError();
    if (missionId) {
      const mission = this.deps.missionStore.getMission(tenantId, missionId);
      if (!mission) throw new StudioMissionNotFoundError(missionId);
      return mission;
    }
    const linked = await this.deps.linkedMission(context, tenantId);
    if (!linked) {
      throw new StudioMissionNotFoundError("(linked to current session)");
    }
    return linked;
  }

  /** 撰写时刻的路由评估快照（counts-only；与 StudioService.routes() 同一评估语义）。 */
  private async routeSnapshotForMission(
    tenantId: string,
    mission: Mission,
  ): Promise<Record<string, number>> {
    if (!this.deps.connectionStore) throw new StudioDataDirUnavailableError();
    const connections = await this.deps.connectionStore.listConnections(tenantId, "composio");
    const facts: RouteInstanceFact[] = [];
    for (const connection of connections) {
      try {
        const instance = this.deps.resolver.resolveForConnection({
          tenantId,
          connection,
          capabilityId: STUDIO_COMPOSIO_CAPABILITY_ID,
          implementationId: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
        });
        const descriptor = this.deps.catalog.getDescriptor(STUDIO_COMPOSIO_CAPABILITY_ID);
        facts.push({
          instance,
          side_effect: descriptor?.sideEffect ?? "unknown",
        });
      } catch {
        // 与 routes() 同语义：解析失败的连接不产生路由事实。
      }
    }
    const evaluation = this.deps.routeService.candidatesForMission(mission, facts);
    const summary = compareRoutes(evaluation.routes);
    return {
      existing: summary.existing,
      conditional: summary.conditional,
      blocked: summary.blocked,
      unknown: summary.unknown,
      total: summary.total,
    };
  }

  /** 简报展示投影：artifact 最新版本 + 最新 review_decision 权利记录实时 join（不镜像）。 */
  private draftBriefProjection(
    tenantId: string,
    brief: DraftBriefRecord,
    artifact: Artifact,
  ): DraftBriefView {
    const review = this.latestReviewForArtifact(tenantId, brief.artifact_id);
    return draftBriefView(
      brief,
      {
        version: artifact.version,
        quality_status: artifact.quality_status,
        rights_status: artifact.rights_status,
      },
      review,
    );
  }

  private latestReviewForArtifact(
    tenantId: string,
    artifactId: string,
  ): DraftBriefReviewView | null {
    if (!this.deps.rightsStore) return null;
    const reviews = this.deps.rightsStore
      .listForArtifact(tenantId, artifactId)
      .filter(
        (record): record is RightsRecord & { decision: "granted" | "denied"; decided_at: string } =>
          record.kind === "review_decision" &&
          (record.decision === "granted" || record.decision === "denied") &&
          typeof record.decided_at === "string" &&
          record.decided_at.length > 0,
      )
      .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1));
    const latest = reviews[0];
    if (!latest) return null;
    return {
      decision: latest.decision === "granted" ? "approved" : "rejected",
      decided_at: latest.decided_at,
      note: null,
    };
  }
}
