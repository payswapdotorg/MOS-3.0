/**
 * mos-agent-organizations 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store/服务方法（≤300 行）。
 */
import type {
  ActorKind,
  AgentBody,
  AgentBodyStatus,
  Money,
  NodeOffer,
  NodeRef,
  OfferAcceptanceEvaluator,
  OfferAvailability,
  OfferStatus,
  Organization,
  OrganizationStatus,
} from "@mos/contracts";

export type {
  ActorKind,
  AgentBody,
  AgentBodyStatus,
  Money,
  NodeOffer,
  NodeRef,
  OfferAcceptanceEvaluator,
  OfferAvailability,
  OfferStatus,
  Organization,
  OrganizationStatus,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation, NODE_OFFER_REQUIRED_DISCLOSURES } from "@mos/contracts";

export type { AgentBodyRegistration } from "./contract/agent-body.js";
export type { OrganizationRegistration } from "./contract/organization.js";
export type {
  NodeOfferDraftInput,
  NodeOfferRecord,
  OfferPublishInput,
  MissingOfferDisclosure,
} from "./contract/node-offer.js";
export { AgentBodyNotFoundError, AgentBodyValidationError } from "./contract/agent-body.js";
export { OrganizationNotFoundError, OrganizationValidationError } from "./contract/organization.js";
export { NodeOfferNotFoundError, OfferPublishBlockedError } from "./contract/node-offer.js";

/**
 * 时钟注入缝（RFC3339 UTC）：结构上与底物 TimePort 兼容，
 * 组合根可直接转发；本包不依赖 zcode-mos-adapters（W2-A 决议）。
 */
export interface TimeSource {
  now(): string;
}

/** 逐字 intake 的注入依赖：时间与 id 由调用方提供（领域层零 Date/random 依赖）。 */
export interface RegistrationDeps {
  readonly id: string;
  readonly now: string;
}
