import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  applyPriceTransition,
  findConflictingActivePrice,
  PriceConflictError,
  PriceNotFoundError,
  priceFromInput,
  PriceStore,
  PriceTransitionError,
  PriceValidationError,
  priceWindowsOverlap,
  retirePrice,
} from "../src/index.js";
import {
  createdPrice,
  LATER,
  OTHER_TENANT,
  priceIntake,
  STORE_FILE_PRICES,
  T1,
  T2,
  TENANT,
} from "./fixtures.js";

const directories: string[] = [];

function makeStore(): { store: PriceStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "mos-commerce-prices-test-"));
  directories.push(directory);
  return { store: new PriceStore({ directory }), directory };
}

describe("priceFromInput (creation is always active, supersession-free)", () => {
  test("forces status=active with superseded_by=null", () => {
    const record = priceFromInput(priceIntake(), { id: "price-1", now: T1 });
    expect(record.status).toBe("active");
    expect(record.superseded_by).toBeNull();
    expect(record.price).toEqual({ amount: "199.00", currency: "USD" });
  });

  test("schema-invalid input fails closed (bad money / bad model)", () => {
    expect(() =>
      priceFromInput(priceIntake({ price: { amount: "19.9.0", currency: "USD" } }), {
        id: "price-1",
        now: T1,
      }),
    ).toThrow(ContractValidationError);
    expect(() =>
      priceFromInput(priceIntake({ pricing_model: "freemium" as never }), {
        id: "price-1",
        now: T1,
      }),
    ).toThrow(ContractValidationError);
  });
});

describe("priceWindowsOverlap (pure window math)", () => {
  test("open-ended windows overlap any later window starting before the end", () => {
    expect(
      priceWindowsOverlap(
        { effective_from: T1, effective_until: null },
        { effective_from: LATER, effective_until: null },
      ),
    ).toBe(true);
  });

  test("disjoint windows do not overlap; boundaries are half-open", () => {
    expect(
      priceWindowsOverlap(
        { effective_from: T1, effective_until: T2 },
        { effective_from: T2, effective_until: LATER },
      ),
    ).toBe(false);
    expect(
      priceWindowsOverlap(
        { effective_from: T1, effective_until: T2 },
        { effective_from: T2, effective_until: null },
      ),
    ).toBe(false);
  });

  test("overlapping windows detected in both directions", () => {
    expect(
      priceWindowsOverlap(
        { effective_from: T1, effective_until: LATER },
        { effective_from: T2, effective_until: null },
      ),
    ).toBe(true);
  });
});

describe("retirePrice (append-only supersession, §24)", () => {
  test("retire only touches status/superseded_by/updated_at", () => {
    const retired = retirePrice(createdPrice(), "price-2", { now: T2 });
    expect(retired.status).toBe("retired");
    expect(retired.superseded_by).toBe("price-2");
    expect(retired.updated_at).toBe(T2);
    expect(retired.price).toEqual({ amount: "199.00", currency: "USD" });
  });

  test("only active prices can retire", () => {
    expect(() => retirePrice(createdPrice({ status: "retired" }), "price-2", { now: T2 })).toThrow(
      PriceTransitionError,
    );
  });

  test("applyPriceTransition only allows retiring", () => {
    expect(() => applyPriceTransition(createdPrice(), "active", { now: T2 })).toThrow(
      PriceTransitionError,
    );
    expect(applyPriceTransition(createdPrice(), "retired", { now: T2 }).status).toBe("retired");
  });
});

describe("findConflictingActivePrice (fail-closed conflict detection)", () => {
  test("same product+model overlapping active windows conflict", () => {
    const existing = createdPrice();
    const candidate = createdPrice({
      id: "price-2",
      effective_from: T2,
    });
    expect(findConflictingActivePrice(candidate, [existing])?.id).toBe("price-1");
  });

  test("different model, different product, disjoint windows and retired records never conflict", () => {
    const existing = createdPrice();
    expect(
      findConflictingActivePrice(
        createdPrice({ id: "price-2", pricing_model: "one_time", effective_from: T2 }),
        [existing],
      ),
    ).toBeNull();
    expect(
      findConflictingActivePrice(
        createdPrice({ id: "price-2", product_id: "product-other", effective_from: T2 }),
        [existing],
      ),
    ).toBeNull();
    expect(
      findConflictingActivePrice(
        createdPrice({ id: "price-2", effective_from: T2, effective_until: null }),
        [createdPrice({ effective_until: T2 })],
      ),
    ).toBeNull();
    expect(
      findConflictingActivePrice(createdPrice({ id: "price-2", effective_from: T2 }), [
        createdPrice({ status: "retired" }),
      ]),
    ).toBeNull();
  });
});

describe("PriceStore (durable, tenant-scoped, append-only history)", () => {
  test("creates active prices and persists them across restarts", () => {
    const { store, directory } = makeStore();
    store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    const reopened = new PriceStore({ directory });
    expect(reopened.getPrice(TENANT, "price-1")?.status).toBe("active");
    expect(reopened.listPricesByProduct(TENANT, "product-1")).toHaveLength(1);
  });

  test("overlapping active window for same product+model fails closed", () => {
    const { store } = makeStore();
    store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    expect(() =>
      store.createPrice(TENANT, priceIntake({ effective_from: T2 }), { id: "price-2", now: T2 }),
    ).toThrow(PriceConflictError);
    expect(store.listPricesByTenant(TENANT)).toHaveLength(1);
  });

  test("supersession appends a new record and retires the old one with a pointer", () => {
    const { store } = makeStore();
    store.createPrice(TENANT, priceIntake({ effective_until: LATER }), { id: "price-1", now: T1 });
    store.createPrice(
      TENANT,
      priceIntake({ price: { amount: "249.00", currency: "USD" }, effective_from: LATER }),
      { id: "price-2", now: T2 },
    );
    const retired = store.retirePrice(TENANT, "price-1", "price-2", { now: T2 });
    expect(retired.status).toBe("retired");
    expect(retired.superseded_by).toBe("price-2");

    const history = store.listPricesByProduct(TENANT, "product-1");
    expect(history).toHaveLength(2);
    expect(history.map((record) => record.price.amount).sort()).toEqual(["199.00", "249.00"]);
  });

  test("retiring an already-retired price fails closed", () => {
    const { store } = makeStore();
    store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    store.retirePrice(TENANT, "price-1", "price-2", { now: T2 });
    expect(() => store.retirePrice(TENANT, "price-1", "price-3", { now: T2 })).toThrow(
      PriceTransitionError,
    );
  });

  test("tenant isolation and typed not-found", () => {
    const { store } = makeStore();
    store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    expect(() => store.getPrice(OTHER_TENANT, "price-1")).toThrow(InvariantViolation);
    expect(() =>
      store.createPrice(OTHER_TENANT, priceIntake(), { id: "price-x", now: T2 }),
    ).toThrow(InvariantViolation);
    expect(() => store.retirePrice(OTHER_TENANT, "price-1", "price-2", { now: T2 })).toThrow(
      InvariantViolation,
    );
    expect(() => store.retirePrice(TENANT, "price-404", "price-2", { now: T2 })).toThrow(
      PriceNotFoundError,
    );
  });

  test("invalid intake fails closed with typed error and nothing persisted", () => {
    const { store } = makeStore();
    expect(() =>
      store.createPrice(TENANT, priceIntake({ price: { amount: "1.2.3", currency: "USD" } }), {
        id: "price-1",
        now: T1,
      }),
    ).toThrow(PriceValidationError);
    expect(store.listPricesByTenant(TENANT)).toHaveLength(0);
  });

  test("corrupted store file fails closed on read", () => {
    const { store, directory } = makeStore();
    store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    writeFileSync(join(directory, STORE_FILE_PRICES), "not json", "utf8");
    expect(() => store.listPricesByTenant(TENANT)).toThrow(ContractValidationError);
  });

  test("store-mediated retire never touches immutable price fields (§24 write path)", () => {
    const { store } = makeStore();
    const created = store.createPrice(TENANT, priceIntake(), { id: "price-1", now: T1 });
    const retired = store.retirePrice(TENANT, "price-1", "price-2", { now: T2 });
    expect(retired.price).toEqual(created.price);
    expect(retired.pricing_model).toBe(created.pricing_model);
    expect(retired.effective_from).toBe(created.effective_from);
    expect(retired.effective_until).toBe(created.effective_until);
    expect(retired.status).toBe("retired");
  });
});

describe("cleanup", () => {
  test("removes temp directories", () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    expect(directories.length).toBeGreaterThan(0);
  });
});
