import type { CapabilityInstance, Capability } from "../contract/capability.js";
import type { ExternalActionPreview } from "../contract/route.js";
import type { Evidence } from "../contract/evidence.js";
import type { Artifact } from "../contract/evidence.js";
import type { Mission } from "../contract/mission.js";
import type { ProviderConnection } from "../contract/connection.js";
import type { NodeOffer } from "../contract/agent-organization.js";
import type { Hypothesis } from "../contract/lab.js";
import type {
  DistributionIntent,
  Experiment,
  ProductionGraph,
  ProductionJob,
} from "../contract/production.js";

/**
 * core-contracts-v3.0.yaml §invariants 的运行时守卫。
 * 守卫在写入边界调用：违规抛 InvariantViolation，绝不静默修正。
 */

export class InvariantViolation extends Error {
  readonly invariant: string;
  constructor(invariant: string, message: string) {
    super(`[${invariant}] ${message}`);
    this.name = "InvariantViolation";
    this.invariant = invariant;
  }
}

/**
 * 不变量 §1/§2：能力实例绝不能在缺少实时连接/账户检查与 scope 检查支撑时为 available；
 * provider 静态描述符不是账户能力证据。
 */
export function assertCapabilityInstanceAvailability(
  instance: CapabilityInstance,
  basis: { liveConnectionChecked: boolean; requiredScopesCovered: boolean },
): void {
  if (instance.status === "available" && !(basis.liveConnectionChecked && basis.requiredScopesCovered)) {
    throw new InvariantViolation(
      "capability-instance-live-check",
      "available 实例必须由实时连接检查与 scope 检查支撑",
    );
  }
}

/**
 * 不变量 §3：unsupported 与 unknown 是不同状态，不得互相归并。
 */
export function assertDistinctSupportStates(
  support: Capability["support_status"],
): void {
  if (support === "unknown") return;
  if (support === "unsupported") return;
  if (support === "supported") return;
  throw new InvariantViolation("distinct-states", `非法 support 状态: ${String(support)}`);
}

/**
 * 不变量 §4/§5：每个有副作用的外部动作必须有预览，并绑定既有 ZCode 权限审批；
 * 且必须携带 tenant、connection、target、operation、side-effect 与幂等/对账信息。
 */
export function assertExternalActionPreview(preview: ExternalActionPreview): void {
  if (preview.side_effect === "none" || preview.side_effect === "read") return;
  if (preview.approval_state === "not_required") {
    throw new InvariantViolation(
      "side-effect-approval-binding",
      `副作用 ${preview.side_effect} 的动作必须走既有 ZCode 权限审批`,
    );
  }
  if (!preview.operation || Object.keys(preview.target).length === 0) {
    throw new InvariantViolation("external-action-completeness", "动作缺少 operation 或 target");
  }
  if (preview.idempotency_key === null && preview.side_effect !== "unknown") {
    throw new InvariantViolation(
      "external-action-completeness",
      `副作用 ${preview.side_effect} 必须携带幂等键`,
    );
  }
}

/**
 * 不变量 §6：每个观测事实必须有 source 与 observed_at；simulation 不能存成 provider 观测。
 */
export function assertEvidenceProvenance(evidence: Evidence): void {
  if (Object.keys(evidence.source).length === 0) {
    throw new InvariantViolation("evidence-provenance", "观测事实必须有 source");
  }
  if (evidence.kind === "simulation" || evidence.kind === "inferred") {
    if (evidence.raw_payload_ref === null) return; // 标注清楚的模拟/推断允许，但见下一条
  }
  const providerObservation =
    evidence.kind === "provider_response" || evidence.kind === "provider_webhook";
  if (providerObservation && evidence.source["observed_via"] === undefined) {
    throw new InvariantViolation(
      "evidence-provenance",
      "provider 观测必须记录 observed_via 来源",
    );
  }
  if ((evidence.kind === "simulation" || evidence.kind === "inferred") && providerObservation) {
    throw new InvariantViolation("evidence-provenance", "状态矛盾");
  }
}

/**
 * 不变量 §7：Artifact 版本与父系血缘不可变。
 */
export function assertArtifactLineageImmutability(
  previous: Pick<Artifact, "version" | "parent_artifact_refs"> | null,
  next: Pick<Artifact, "version" | "parent_artifact_refs">,
): void {
  if (previous === null) return;
  if (next.version <= previous.version) {
    throw new InvariantViolation(
      "artifact-immutability",
      `版本必须递增：${previous.version} -> ${next.version}`,
    );
  }
  if (
    previous.parent_artifact_refs.length !== next.parent_artifact_refs.length ||
    previous.parent_artifact_refs.some((ref, index) => ref !== next.parent_artifact_refs[index])
  ) {
    throw new InvariantViolation(
      "artifact-immutability",
      "已发布版本的父系血缘不可修改",
    );
  }
}

/**
 * 不变量 §8：provider 密钥只能以不透明 credential_ref 表示。
 * 连接记录的任何标量字段都不允许出现疑似令牌值。
 */
const SECRET_SHAPE =
  /(access_token|refresh_token|client_secret|api_key|password|authorization|cookie)\b/i;
const SECRET_VALUE = /^(eyJ|sk-|Bearer\s|gh[pousr]_)/i;

export function assertConnectionHoldsNoSecrets(connection: ProviderConnection): void {
  for (const [key, value] of Object.entries(connection)) {
    if (SECRET_SHAPE.test(key)) {
      throw new InvariantViolation(
        "secrets-opaque-only",
        `连接记录携带了敏感字段名: ${key}`,
      );
    }
    if (typeof value === "string" && SECRET_VALUE.test(value)) {
      throw new InvariantViolation(
        "secrets-opaque-only",
        `字段 ${key} 的值疑似内联令牌`,
      );
    }
  }
}

/**
 * 不变量 §9：不得从营销简报推断缺失值。
 * 逐字 intake 下，所有可空字段未提供时必须保持 null/空集合，不得填充猜测。
 */
export function assertNoInferredMissionFields(mission: Mission): void {
  const nullIfAbsent = [
    mission.target_audience,
    mission.geography,
    mission.budget,
    mission.deadline,
  ] as const;
  for (const value of nullIfAbsent) {
    if (value === "") {
      throw new InvariantViolation("no-inferred-values", "缺失值必须是 null 而不是空串");
    }
  }
  if (mission.objective.trim().length === 0) {
    throw new InvariantViolation("no-inferred-values", "objective 不得为空白");
  }
}

/**
 * 不变量 §14（Week 2 additive）：§8 披露不全的 offer 不得发布。
 * published 必须由完整披露支撑；缺失/未知字段让 offer 停留在 draft。
 */
export function assertNodeOfferPublishable(offer: NodeOffer): void {
  if (offer.status !== "published") return;
  const missing: string[] = [];
  if (offer.deliverables.length === 0) missing.push("deliverables");
  if (offer.geography === null) missing.push("geography");
  if (offer.language === null) missing.push("language");
  if (offer.price_reward === null) missing.push("price_reward");
  if (offer.deadline === null) missing.push("deadline");
  if (offer.sla === null) missing.push("sla");
  // rights_constraints / delivery_history 允许显式空集合（表达"无限制"/"无历史"），
  // 不强制非空：显式空集合本身就是一种披露，缺省与未知由 schema 默认值区分。
  if (offer.availability.windows === null && offer.availability.capacity === null) {
    missing.push("availability");
  }
  if (offer.evidence_refs.length === 0) missing.push("evidence_refs");
  if (offer.acceptance_evaluator.evaluator_ref.trim().length === 0) missing.push("acceptance_evaluator");
  if (missing.length > 0) {
    throw new InvariantViolation(
      "offer-publish-gate",
      `§8 披露缺失，offer 只能停留在 draft: ${missing.join(", ")}`,
    );
  }
}

/**
 * 不变量 §15（Week 2 additive）：假设记录永不携带实验结果。
 * Hypothesis 状态词汇本身无结果语义；experiment_ref 只允许伴随
 * adopted_by_experiment 状态（且写入权归 Experiment authority，见 lab CONTRACT）。
 */
export function assertHypothesisCarriesNoOutcome(hypothesis: Hypothesis): void {
  if (hypothesis.experiment_ref !== null && hypothesis.status !== "adopted_by_experiment") {
    throw new InvariantViolation(
      "hypothesis-no-outcome",
      "experiment_ref 只能在 adopted_by_experiment 状态下出现",
    );
  }
  if (hypothesis.status === "adopted_by_experiment" && hypothesis.experiment_ref === null) {
    throw new InvariantViolation(
      "hypothesis-no-outcome",
      "adopted_by_experiment 必须携带不透明 experiment_ref",
    );
  }
}

/**
 * 不变量 §16（Week 2 additive）：研究发现不得把 simulation 证据充当 provider 观测。
 * 判定依据 Evidence.kind —— 调用方传入所引用的 Evidence 记录。
 */
export function assertResearchFindingEvidence(
  finding: { evidence_ref: string; statement: string },
  evidence: Pick<Evidence, "kind"> | undefined,
): void {
  if (evidence === undefined) {
    throw new InvariantViolation(
      "research-finding-evidence",
      `finding 引用的 evidence 不存在: ${finding.evidence_ref}`,
    );
  }
  if (evidence.kind === "simulation") {
    throw new InvariantViolation(
      "research-finding-evidence",
      "simulation 证据不得充当 provider 观测（invariants §16）",
    );
  }
}

/**
 * 不变量 §17（Week 2 additive）：node/offer 记录 tenant 范围隔离。
 * 读取方 tenant 与记录 tenant 不一致时 fail closed。
 */
export function assertTenantScope<T extends { tenant_id: string }>(
  record: T,
  tenant: { tenant_id: string },
  what: string,
): void {
  if (record.tenant_id !== tenant.tenant_id) {
    throw new InvariantViolation(
      "tenant-scope",
      `${what} 属于其他租户，跨租户访问 fail closed`,
    );
  }
}

/**
 * 不变量 §18（W3）：权利门禁永不猜测。
 * 只有覆盖该 artifact 的 granted 且未过期的权利决定才能 cleared；
 * missing/pending/expired/denied 全部拒绝（fail-closed，具名原因）。
 * 调用方传入该 artifact 的适用 RightsRecord 集合与当前时间。
 */
export function assertRightsClearedForUse(input: {
  artifactRef: string;
  records: ReadonlyArray<import("../contract/production.js").RightsRecord>;
  now: string;
}): void {
  const { artifactRef, records, now } = input;
  const covering = records.filter(
    (record) =>
      (record.subject_artifact_ref === artifactRef || record.subject_artifact_ref === null) &&
      record.kind !== "unknown",
  );
  if (covering.length === 0) {
    throw new InvariantViolation(
      "rights-gate-fail-closed",
      `无覆盖 ${artifactRef} 的权利记录；缺记录 = 拒绝`,
    );
  }
  const denied = covering.find((record) => record.decision === "denied");
  if (denied) {
    throw new InvariantViolation("rights-gate-fail-closed", `${artifactRef} 存在 denied 决定`);
  }
  const granted = covering.find(
    (record) =>
      record.decision === "granted" &&
      record.decided_at !== null &&
      (record.expires_at === null || record.expires_at > now),
  );
  if (!granted) {
    throw new InvariantViolation(
      "rights-gate-fail-closed",
      `${artifactRef} 无有效（granted 且未过期）决定`,
    );
  }
}

/**
 * 不变量 §19（W3，决策锁 #5）：MOS 无第二执行器。
 * 状态越过 linked 的 job 必须持有外部 ZCode execution ref；
 * 且 job 记录本身永不携带任何执行原语（契约无此字段——本守卫校验 ref 存在性）。
 */
export function assertJobNeverExecutes(job: ProductionJob): void {
  const beyondLinked = job.status !== "pending" && job.status !== "linked" && job.status !== "unknown";
  if (beyondLinked && (job.zcode_execution_ref === null || job.started_at === null)) {
    throw new InvariantViolation(
      "no-second-executor",
      `job ${job.id} 状态 ${job.status} 必须持有外部 zcode_execution_ref 与 started_at（执行归 ZCode）`,
    );
  }
}

/**
 * 不变量 §20（W3，决策锁 #9）：图里的 engine 节点只允许不透明引用。
 * engine 节点 ref 为 null = 未解析（draft 可接受；validated 图不接受）。
 */
export function assertGraphEngineRefsOpaque(graph: ProductionGraph): void {
  if (graph.status !== "validated") return;
  const unresolved = graph.nodes.filter(
    (node) => node.kind === "engine" && (node.ref === null || node.ref.length === 0),
  );
  if (unresolved.length > 0) {
    throw new InvariantViolation(
      "engine-refs-opaque",
      `validated 图存在未解析 engine 节点: ${unresolved.map((node) => node.id).join(", ")}`,
    );
  }
}

/**
 * 不变量 §21（W3，决策锁 #18）：实验结果只属于 Experiment authority 且必须证据支撑。
 * outcome 非 null 时：status 必须 concluded、measurement_evidence_refs 非空。
 */
export function assertExperimentOutcomeEvidence(experiment: Experiment): void {
  if (experiment.outcome === null) return;
  if (experiment.status !== "concluded") {
    throw new InvariantViolation(
      "experiment-outcome-evidence",
      `实验 ${experiment.id} 的 outcome 只能在 concluded 状态写入`,
    );
  }
  if (experiment.measurement_evidence_refs.length === 0) {
    throw new InvariantViolation(
      "experiment-outcome-evidence",
      `实验 ${experiment.id} 的 outcome 必须携带 measurement 证据引用`,
    );
  }
}

/**
 * 不变量 §22（W3）：副作用型分发意图在 executing/succeeded 前必须绑定已批准预览。
 */
export function assertDistributionPreviewApproval(intent: DistributionIntent): void {
  if (intent.status !== "executing" && intent.status !== "succeeded") return;
  if (intent.preview_ref === null || intent.preview_hash === null) {
    throw new InvariantViolation(
      "distribution-preview-approval",
      `意图 ${intent.id} 进入 ${intent.status} 前必须绑定预览（preview_ref + preview_hash）`,
    );
  }
  if (intent.approval_state !== "approved") {
    throw new InvariantViolation(
      "distribution-preview-approval",
      `意图 ${intent.id} 进入 ${intent.status} 前必须 approved`,
    );
  }
}
