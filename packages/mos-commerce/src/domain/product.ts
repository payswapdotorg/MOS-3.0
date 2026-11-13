import { assertTenantScope, commerceProductSchema, parseOrFail } from "@mos/contracts";
import type { CommerceProduct, ProductStatus } from "@mos/contracts";
import { productRegistrationInputSchema } from "../contract/product.js";
import {
  PRODUCT_STATUS_DRAFT,
  ProductTransitionError,
} from "../contract/product.js";
import type { ProductRegistrationInput } from "../contract/product.js";

/** 合法转移表（具名状态机；unknown 无出边 —— fail-closed）。 */
export const LEGAL_PRODUCT_TRANSITIONS: Readonly<
  Record<ProductStatus, readonly ProductStatus[]>
> = {
  draft: ["active", "retired"],
  active: ["retired"],
  retired: [],
  unknown: [],
};

/** 判定 (current, target) 是否合法边。 */
export function isLegalProductTransition(
  current: ProductStatus,
  target: ProductStatus,
): boolean {
  return (LEGAL_PRODUCT_TRANSITIONS[current] as readonly ProductStatus[]).includes(target);
}

/** 登记输入 → CommerceProduct（纯函数；登记恒为 draft）。 */
export function productFromInput(
  input: ProductRegistrationInput,
  deps: { id: string; now: string },
): CommerceProduct {
  const normalized = parseOrFail(
    "ProductRegistrationInput",
    productRegistrationInputSchema,
    input,
  ) as ProductRegistrationInput;

  const product: CommerceProduct = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    name: normalized.name,
    description: normalized.description,
    artifact_refs: [...normalized.artifact_refs],
    status: PRODUCT_STATUS_DRAFT,
    created_at: deps.now,
    updated_at: deps.now,
  };
  assertTenantScope(product, { tenant_id: normalized.tenant_id }, "commerce product");
  return parseOrFail("CommerceProduct", commerceProductSchema, product) as CommerceProduct;
}

/** 通用合法转移（active / retired）。 */
export function applyProductTransition(
  product: CommerceProduct,
  target: ProductStatus,
  deps: { now: string },
): CommerceProduct {
  if (!isLegalProductTransition(product.status, target)) {
    throw new ProductTransitionError(product.status, target);
  }
  const next: CommerceProduct = { ...product, status: target, updated_at: deps.now };
  return parseOrFail("CommerceProduct", commerceProductSchema, next) as CommerceProduct;
}
