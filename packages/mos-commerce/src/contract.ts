/**
 * mos-commerce 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 错误再导出；store 的 class 形状由 src/application/* 声明，
 * 本文件不声明 store 方法（与 mos-lab / mos-distribution 的 contract.ts 同模式）。
 */
export type {
  CommerceProduct,
  ProductStatus,
  PriceRecord,
  PriceStatus,
  PricingModel,
  MarketIntelligenceRecord,
} from "@mos/contracts";
export { ContractValidationError, InvariantViolation } from "@mos/contracts";

export type { ProductRegistrationInput } from "./contract/product.js";
export {
  PRODUCT_STATUS_DRAFT,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_RETIRED,
  ProductNotFoundError,
  ProductValidationError,
  ProductTransitionError,
} from "./contract/product.js";

export type { PriceIntake } from "./contract/pricing.js";
export {
  PRICE_STATUS_ACTIVE,
  PRICE_STATUS_RETIRED,
  PriceNotFoundError,
  PriceValidationError,
  PriceConflictError,
  PriceTransitionError,
} from "./contract/pricing.js";

export type { MarketIntelligenceIntake } from "./contract/market-intelligence.js";
export { MarketIntelligenceValidationError } from "./contract/market-intelligence.js";
