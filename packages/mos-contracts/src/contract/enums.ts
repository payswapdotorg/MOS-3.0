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

export const qualityStatusSchema = z.enum(["unreviewed", "approved", "rejected", "unknown"]);
export type QualityStatus = z.infer<typeof qualityStatusSchema>;
