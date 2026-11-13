/**
 * mos-contracts 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型从这里窄口导出；schema 的完整集合经 index.ts 提供。
 * 注意：contract.ts 上限 300 行、公开方法上限 12（本文件不声明方法）。
 */
export type {
  Rfc3339Timestamp,
  OpaqueId,
  OpaqueRef,
  Money,
  ProvenanceSource,
  ContractVersion,
} from "./contract/common.js";
export type {
  CapabilitySupport,
  ImplementationStatus,
  RouteClass,
  RouteStatus,
  RiskLevel,
  SideEffect,
  EvidenceKind,
  ActorKind,
  ArtifactKind,
  AuthMethod,
  ConnectionStatus,
  ApprovalState,
  RightsStatus,
  QualityStatus,
} from "./contract/enums.js";
export type { TenantContext } from "./contract/tenant.js";
export type { Mission, MissionIntake } from "./contract/mission.js";
export type {
  ProviderConnection,
  ProviderConnectionUpsert,
} from "./contract/connection.js";
export type {
  Capability,
  ProviderImplementation,
  CapabilityInstance,
} from "./contract/capability.js";
export type { Route, ExternalActionPreview } from "./contract/route.js";
export type { Evidence, Artifact, DomainEvent } from "./contract/evidence.js";
export type {
  NodeRef,
  AgentBody,
  Organization,
  OfferAvailability,
  OfferAcceptanceEvaluator,
  NodeOffer,
} from "./contract/agent-organization.js";
export type { ResearchFinding, ResearchNote, Hypothesis } from "./contract/lab.js";
export type {
  Transform,
  Engine,
  ProductionNodeKind,
  ProductionGraphNode,
  ProductionGraphEdge,
  ProductionGraph,
  ProductionJob,
  RightsRecord,
  DistributionIntent,
  Experiment,
  CalibrationRecord,
} from "./contract/production.js";
export {
  PRODUCTION_NODE_KINDS,
} from "./contract/production.js";
export { NODE_OFFER_REQUIRED_DISCLOSURES } from "./contract/agent-organization.js";
export { InvariantViolation } from "./domain/invariants.js";
export { ContractValidationError } from "./application/validate.js";
