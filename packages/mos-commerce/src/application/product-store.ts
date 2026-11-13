import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertTenantScope,
  commerceProductSchema,
  ContractValidationError,
  parseOrFail,
} from "@mos/contracts";
import type { CommerceProduct, ProductStatus } from "@mos/contracts";
import { productRegistrationInputSchema } from "../contract/product.js";
import {
  ProductNotFoundError,
  ProductValidationError,
} from "../contract/product.js";
import type { ProductRegistrationInput } from "../contract/product.js";
import { applyProductTransition, productFromInput } from "../domain/product.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-commerce-products.json";
const STORE_SCHEMA_VERSION = 1;

export interface ProductStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped CommerceProduct 存储（与 W2/W3 各 store 同模式）。
 * - 文件后端、原子写（同目录 tmp + rename）、fail-closed 读取（损坏即拒读）。
 * - 读取容忍未知键（additive 契约演化），结构/schema 破坏必须 fail-closed。
 * - 租户边界：跨租户读/写一律 InvariantViolation（绝不静默降级）。
 */
export class ProductStore {
  private readonly directory: string;

  constructor(options: ProductStoreOptions) {
    this.directory = options.directory;
  }

  /** 登记产品（创建恒为 draft）。 */
  registerProduct(
    tenantId: string,
    productId: string,
    input: ProductRegistrationInput,
    deps: { now: string },
  ): CommerceProduct {
    let normalized: ProductRegistrationInput;
    try {
      normalized = parseOrFail(
        "ProductRegistrationInput",
        productRegistrationInputSchema,
        input,
      ) as ProductRegistrationInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new ProductValidationError(error.issues);
      }
      throw error;
    }
    const record = productFromInput(normalized, { id: productId, now: deps.now });
    assertTenantScope(record, { tenant_id: tenantId }, "commerce product");
    const all = this.readAll();
    const existing = all.find(
      (candidate) =>
        candidate.tenant_id === tenantId && candidate.id === productId,
    );
    if (existing !== undefined) {
      throw new ProductValidationError([
        `product ${productId} already exists in tenant ${tenantId}`,
      ]);
    }
    this.persist(all, record);
    return record;
  }

  getProduct(tenantId: string, productId: string): CommerceProduct | null {
    const found = this.readAll().find((record) => record.id === productId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "commerce product");
    return found;
  }

  /** 列出调用方租户的全部产品（其他租户的记录不可见）。 */
  listProductsByTenant(tenantId: string): readonly CommerceProduct[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 状态转移（draft → active → retired；非法转移 fail-closed）。 */
  applyTransition(
    tenantId: string,
    productId: string,
    target: ProductStatus,
    deps: { now: string },
  ): CommerceProduct {
    const all = this.readAll();
    const current = this.findProduct(all, tenantId, productId);
    const next = applyProductTransition(current, target, deps);
    this.persist(all, next);
    return next;
  }

  private findProduct(
    all: readonly CommerceProduct[],
    tenantId: string,
    productId: string,
  ): CommerceProduct {
    const found = all.find((record) => record.id === productId);
    if (found === undefined) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "commerce product");
    return found;
  }

  /** 落盘前统一守卫：schema 再校验（defense in depth）。 */
  private persist(all: readonly CommerceProduct[], record: CommerceProduct): void {
    const validated = parseOrFail(
      "CommerceProduct",
      commerceProductSchema,
      record,
    ) as CommerceProduct;
    const existing = all.find(
      (candidate) =>
        candidate.tenant_id === validated.tenant_id && candidate.id === validated.id,
    );
    this.writeAll(
      existing === undefined
        ? [...all, validated]
        : all.map((candidate) => (candidate === existing ? validated : candidate)),
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly CommerceProduct[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("ProductStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("ProductStore", [
        "存储文件结构必须是 { version, products }",
      ]);
    }
    const products = (parsed as { products?: unknown }).products;
    if (!Array.isArray(products)) {
      throw new ContractValidationError("ProductStore", [
        "存储文件缺少 products 数组",
      ]);
    }
    return products.map(
      (record) =>
        parseOrFail("CommerceProduct", commerceProductSchema, record) as CommerceProduct,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(products: readonly CommerceProduct[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, products }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
