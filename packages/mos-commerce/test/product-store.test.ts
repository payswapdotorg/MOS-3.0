import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  applyProductTransition,
  isLegalProductTransition,
  LEGAL_PRODUCT_TRANSITIONS,
  ProductNotFoundError,
  ProductStore,
  ProductTransitionError,
  ProductValidationError,
  productFromInput,
} from "../src/index.js";
import {
  OTHER_TENANT,
  productRegistrationInput,
  registeredProduct,
  STORE_FILE_PRODUCTS,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

const directories: string[] = [];

function makeStore(): { store: ProductStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "mos-commerce-products-test-"));
  directories.push(directory);
  return { store: new ProductStore({ directory }), directory };
}

describe("productFromInput (creation is always draft)", () => {
  test("forces status=draft with opaque artifact refs", () => {
    const product = productFromInput(productRegistrationInput(), { id: "product-1", now: T1 });
    expect(product.status).toBe("draft");
    expect(product.artifact_refs).toEqual(["art-1", "art-2"]);
  });

  test("schema-invalid input fails closed", () => {
    expect(() =>
      productFromInput(productRegistrationInput({ name: "" }), { id: "product-1", now: T1 }),
    ).toThrow(ContractValidationError);
  });
});

describe("product transitions (named state machine)", () => {
  test("legal chain draft -> active -> retired", () => {
    let product = registeredProduct();
    product = applyProductTransition(product, "active", { now: T2 });
    expect(product.status).toBe("active");
    product = applyProductTransition(product, "retired", { now: T2 });
    expect(product.status).toBe("retired");
  });

  test("draft may retire directly; retired is terminal; unknown has no out-edges", () => {
    expect(isLegalProductTransition("draft", "retired")).toBe(true);
    expect(isLegalProductTransition("retired", "active")).toBe(false);
    expect(LEGAL_PRODUCT_TRANSITIONS.unknown).toEqual([]);
    expect(() =>
      applyProductTransition(registeredProduct({ status: "unknown" }), "active", { now: T2 }),
    ).toThrow(ProductTransitionError);
  });
});

describe("ProductStore (durable, tenant-scoped)", () => {
  test("registers draft products and persists them across restarts", () => {
    const { store, directory } = makeStore();
    const product = store.registerProduct(TENANT, "product-1", productRegistrationInput(), {
      now: T1,
    });
    expect(product.status).toBe("draft");

    const reopened = new ProductStore({ directory });
    const reread = reopened.getProduct(TENANT, "product-1");
    expect(reread?.name).toBe("Launch content bundle");
  });

  test("duplicate product id in tenant fails closed", () => {
    const { store } = makeStore();
    store.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T1 });
    expect(() =>
      store.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T2 }),
    ).toThrow(ProductValidationError);
  });

  test("activation and retirement through the store", () => {
    const { store } = makeStore();
    store.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T1 });
    expect(store.applyTransition(TENANT, "product-1", "active", { now: T2 }).status).toBe("active");
    expect(store.applyTransition(TENANT, "product-1", "retired", { now: T2 }).status).toBe(
      "retired",
    );
    expect(() => store.applyTransition(TENANT, "product-1", "active", { now: T2 })).toThrow(
      ProductTransitionError,
    );
  });

  test("tenant isolation and typed not-found", () => {
    const { store } = makeStore();
    store.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T1 });
    expect(() => store.getProduct(OTHER_TENANT, "product-1")).toThrow(InvariantViolation);
    expect(store.listProductsByTenant(OTHER_TENANT)).toHaveLength(0);
    expect(() =>
      store.registerProduct(OTHER_TENANT, "product-x", productRegistrationInput(), { now: T2 }),
    ).toThrow(InvariantViolation);
    expect(() => store.applyTransition(OTHER_TENANT, "product-1", "active", { now: T2 })).toThrow(
      InvariantViolation,
    );
    expect(() => store.applyTransition(TENANT, "product-404", "active", { now: T2 })).toThrow(
      ProductNotFoundError,
    );
  });

  test("corrupted store file fails closed on read", () => {
    const { store, directory } = makeStore();
    store.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T1 });
    writeFileSync(join(directory, STORE_FILE_PRODUCTS), "not json", "utf8");
    expect(() => store.listProductsByTenant(TENANT)).toThrow(ContractValidationError);

    const { store: store2, directory: directory2 } = makeStore();
    store2.registerProduct(TENANT, "product-1", productRegistrationInput(), { now: T1 });
    writeFileSync(
      join(directory2, STORE_FILE_PRODUCTS),
      JSON.stringify({ version: 1, products: [registeredProduct({ name: "" })] }, null, 2),
      "utf8",
    );
    expect(() => store2.getProduct(TENANT, "product-1")).toThrow(ContractValidationError);
  });
});

describe("cleanup", () => {
  test("removes temp directories", () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    expect(directories.length).toBeGreaterThan(0);
  });
});
