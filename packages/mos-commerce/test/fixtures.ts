import type { CommerceProduct, MarketIntelligenceRecord, PriceRecord } from "@mos/contracts";
import {
  marketIntelligenceFromInput,
  priceFromInput,
  productFromInput,
} from "../src/index.js";
import type {
  MarketIntelligenceIntake,
  PriceIntake,
  ProductRegistrationInput,
} from "../src/index.js";

export const T1 = "2026-11-14T00:00:00Z";
export const T2 = "2026-11-14T01:00:00Z";
export const T3 = "2026-11-14T02:00:00Z";
export const LATER = "2026-12-01T00:00:00Z";
export const TENANT = "tenant-acme";
export const OTHER_TENANT = "tenant-globex";
export const STORE_FILE_PRODUCTS = "mos-commerce-products.json";
export const STORE_FILE_PRICES = "mos-commerce-prices.json";
export const STORE_FILE_INTEL = "mos-commerce-intelligence.json";
export const PRODUCT_ID = "product-1";

export function productRegistrationInput(
  overrides: Partial<ProductRegistrationInput> = {},
): ProductRegistrationInput {
  return {
    tenant_id: TENANT,
    name: "Launch content bundle",
    description: null,
    artifact_refs: ["art-1", "art-2"],
    ...overrides,
  };
}

export function registeredProduct(
  overrides: Partial<CommerceProduct> = {},
  inputOverrides: Partial<ProductRegistrationInput> = {},
): CommerceProduct {
  const product = productFromInput(productRegistrationInput(inputOverrides), {
    id: PRODUCT_ID,
    now: T1,
  });
  return { ...product, ...overrides };
}

export function priceIntake(overrides: Partial<PriceIntake> = {}): PriceIntake {
  return {
    tenant_id: TENANT,
    product_id: PRODUCT_ID,
    price: { amount: "199.00", currency: "USD" },
    pricing_model: "subscription",
    effective_from: T1,
    effective_until: null,
    evidence_refs: ["ev-price-1"],
    ...overrides,
  };
}

export function createdPrice(
  overrides: Partial<PriceRecord> = {},
  intakeOverrides: Partial<PriceIntake> = {},
): PriceRecord {
  const record = priceFromInput(priceIntake(intakeOverrides), { id: "price-1", now: T1 });
  return { ...record, ...overrides };
}

export function intelligenceIntake(
  overrides: Partial<MarketIntelligenceIntake> = {},
): MarketIntelligenceIntake {
  return {
    tenant_id: TENANT,
    topic: "segment price sensitivity",
    subject_ref: "segment-smb-gh",
    facts: { median_acceptable_price_usd: "149.00" },
    evidence_refs: ["ev-intel-1"],
    insight: "SMB segment tolerates up to 149 USD/mo",
    confidence: 0.72,
    limitations: ["sample size 40"],
    observed_at: T1,
    ...overrides,
  };
}

export function createdIntelligence(
  overrides: Partial<MarketIntelligenceRecord> = {},
  intakeOverrides: Partial<MarketIntelligenceIntake> = {},
): MarketIntelligenceRecord {
  const record = marketIntelligenceFromInput(intelligenceIntake(intakeOverrides), {
    id: "intel-1",
    now: T1,
  });
  return { ...record, ...overrides };
}
