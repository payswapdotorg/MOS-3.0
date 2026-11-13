import { z } from "zod";

/**
 * core-contracts-v3.0.yaml §enums 的机读投影。
 * 枚举新增只能走 additive-with-version-bump（契约演化约定）。
 */

export const capabilitySupportSchema = z.enum([
  "supported",
  "unsupported",
  "unknown",
]);
export type CapabilitySupport = z.infer<typeof capabilitySupportSchema>;

export const implementationStatusSchema = z.enum([
  "available",
  "degraded",
  "unavailable",
  "unknown",
]);
export type ImplementationStatus = z.infer<typeof implementationStatusSchema>;

export const routeClassSchema = z.enum([
  "existing",
  "conditional",
  "opportunity_constrained",
  "blocked",
  "unknown",
]);
export type RouteClass = z.infer<typeof routeClassSchema>;

export const routeStatusSchema = z.enum([
  "candidate",
  "ready_for_approval",
  "executing",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "unknown",
]);
export type RouteStatus = z.infer<typeof routeStatusSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical", "unknown"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const sideEffectSchema = z.enum([
  "none",
  "read",
  "create",
  "update",
  "publish",
  "message",
  "spend",
  "delete",
  "irreversible",
  "unknown",
]);
export type SideEffect = z.infer<typeof sideEffectSchema>;

export const evidenceKindSchema = z.enum([
  "provider_response",
  "provider_webhook",
  "user_confirmation",
  "human_review",
  "platform_insight",
  "analytics_event",
  "experiment_observation",
  "simulation",
  "inferred",
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const actorKindSchema = z.enum([
  "human",
  "agent",
  "engine",
  "tool",
  "provider",
  "organization",
  "team",
]);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const artifactKindSchema = z.enum([
  "source",
  "draft",
  "media",
  "copy",
  "campaign",
  "evidence",
  "report",
  "transcript",
  "caption",
  "derivative",
  "unknown",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

/**
 * core-contracts-v3.0.yaml 中标为 `enum` 但未点名的状态字段，按 additive 原则补齐命名枚举。
 * 任何新增值都必须保持 fail-closed 语义（unknown 永远存在）。
 */

export const authMethodSchema = z.enum([
  "oauth_authorization_code",
  "oauth_client_credentials",
  "zcode_official_mcp",
  // Week 2 additive：provider 文档化的 API-key header 授权（连接材料仍只存不透明
  // credential_ref；header 值由组合根在运行时从凭据存储注入，永不落源码/日志）。
  "api_key",
  "unknown",
]);
export type AuthMethod = z.infer<typeof authMethodSchema>;

export const connectionStatusSchema = z.enum([
  "connected",
  "expired",
  "revoked",
  "error",
  "unknown",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const approvalStateSchema = z.enum([
  "not_required",
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export const rightsStatusSchema = z.enum(["cleared", "restricted", "unknown"]);
export type RightsStatus = z.infer<typeof rightsStatusSchema>;

/**
 * Week 2 additive 状态枚举（core-contracts-v3.0.yaml §enums，additive-only）。
 * - offer：architecture §8 披露不全的 offer 只能停留在 draft（fail-closed 发布门禁）。
 * - hypothesis：决策锁 #18——Lab 只提出假设，实验结果归 Experiment authority；
 *   因此状态词汇里没有任何结果语义（无 validated/succeeded/failed）。
 */
export const offerStatusSchema = z.enum([
  "draft",
  "published",
  "withdrawn",
  "expired",
  "unknown",
]);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

export const hypothesisStatusSchema = z.enum([
  "proposed",
  "superseded",
  "withdrawn",
  "adopted_by_experiment",
  "unknown",
]);
export type HypothesisStatus = z.infer<typeof hypothesisStatusSchema>;

export const organizationStatusSchema = z.enum(["active", "inactive", "unknown"]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const agentBodyStatusSchema = z.enum(["active", "inactive", "unknown"]);
export type AgentBodyStatus = z.infer<typeof agentBodyStatusSchema>;

/**
 * Week 3 additive 状态枚举（core-contracts-v3.0.yaml §enums，additive-only）。
 * - production_job_status 的 linked = 已绑定外部 ZCode execution ref（决策锁 #5：
 *   MOS 不执行任何东西，只记录业务状态）。
 * - experiment_outcome 只在 Experiment authority 可写（决策锁 #18）。
 */
export const transformStatusSchema = z.enum(["draft", "active", "retired", "unknown"]);
export type TransformStatus = z.infer<typeof transformStatusSchema>;

export const engineStatusSchema = z.enum([
  "registered",
  "benchmarked",
  "deprecated",
  "unknown",
]);
export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const productionGraphStatusSchema = z.enum([
  "draft",
  "validated",
  "invalidated",
  "unknown",
]);
export type ProductionGraphStatus = z.infer<typeof productionGraphStatusSchema>;

export const productionJobStatusSchema = z.enum([
  "pending",
  "linked",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);
export type ProductionJobStatus = z.infer<typeof productionJobStatusSchema>;

export const distributionStatusSchema = z.enum([
  "intent",
  "previewed",
  "pending_approval",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
  "unknown",
]);
export type DistributionStatus = z.infer<typeof distributionStatusSchema>;

export const rightsKindSchema = z.enum([
  "source_license",
  "consent",
  "platform_policy",
  "review_decision",
  "unknown",
]);
export type RightsKind = z.infer<typeof rightsKindSchema>;

export const rightsDecisionSchema = z.enum([
  "granted",
  "denied",
  "pending",
  "expired",
  "unknown",
]);
export type RightsDecision = z.infer<typeof rightsDecisionSchema>;

export const experimentStatusSchema = z.enum([
  "defined",
  "assigned",
  "measuring",
  "analyzed",
  "concluded",
  "cancelled",
  "unknown",
]);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

export const experimentOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "inconclusive",
  "unknown",
]);
export type ExperimentOutcome = z.infer<typeof experimentOutcomeSchema>;

export const qualityStatusSchema = z.enum(["unreviewed", "approved", "rejected", "unknown"]);
export type QualityStatus = z.infer<typeof qualityStatusSchema>;

/**
 * Week 4 additive 状态枚举（core-contracts-v3.0.yaml §enums，additive-only；
 * economy / network capacity —— authority: resource-network / commerce）。
 * - execution_option_adequacy 的 unknown 绝不算 adequate（决策锁 #14 投影）。
 * - gig_status 的 assigned 之后人工指派必须已通过 §23 路线比较守卫。
 */
export const networkNodeStatusSchema = z.enum(["active", "inactive", "unknown"]);
export type NetworkNodeStatus = z.infer<typeof networkNodeStatusSchema>;

export const gigStatusSchema = z.enum([
  "draft",
  "published",
  "assigned",
  "in_progress",
  "delivered",
  "accepted",
  "rejected",
  "cancelled",
  "unknown",
]);
export type GigStatus = z.infer<typeof gigStatusSchema>;

export const executionOptionKindSchema = z.enum([
  "human_offer",
  "agent_offer",
  "engine",
  "no_op_reuse",
]);
export type ExecutionOptionKind = z.infer<typeof executionOptionKindSchema>;

export const executionOptionAdequacySchema = z.enum([
  "adequate",
  "inadequate",
  "unapproved",
  "unknown",
]);
export type ExecutionOptionAdequacy = z.infer<typeof executionOptionAdequacySchema>;

export const executionRecommendationSchema = z.enum([
  "no_op_reuse",
  "agent_or_engine",
  "human",
  "no_adequate_route",
]);
export type ExecutionRecommendation = z.infer<typeof executionRecommendationSchema>;

export const productStatusSchema = z.enum(["draft", "active", "retired", "unknown"]);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const pricingModelSchema = z.enum([
  "one_time",
  "subscription",
  "usage_based",
  "revenue_share",
  "unknown",
]);
export type PricingModel = z.infer<typeof pricingModelSchema>;

export const priceStatusSchema = z.enum(["active", "retired", "unknown"]);
export type PriceStatus = z.infer<typeof priceStatusSchema>;
