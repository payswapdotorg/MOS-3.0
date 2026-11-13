import { describe, expect, test } from "vitest";
import { NODE_OFFER_REQUIRED_DISCLOSURES } from "@mos/contracts";
import {
  missingOfferDisclosures,
  nodeOfferFromDraftInput,
} from "../src/index.js";
import type { NodeOfferDraftInput, NodeOfferRecord } from "../src/index.js";

/**
 * §8 披露门禁矩阵（domain/offer-gate.ts，纯函数）：
 * 缺失名单必须与 NODE_OFFER_REQUIRED_DISCLOSURES 语义一致——
 * null 视为缺失；deliverables/evidence_refs 空数组视为缺失；
 * rights_constraints/delivery_history 显式空数组 = 披露"无"，不缺失；
 * availability 整体 null 或 windows/capacity 同时 null 视为缺失；
 * 纯函数永不变异输入。
 */

const NOW = "2026-11-13T00:00:00Z";

/** 全披露草稿（§8 每个字段都已披露；rights_constraints/delivery_history/inputs 允许显式空数组）。 */
function disclosedDraft(overrides: Partial<NodeOfferDraftInput> = {}): NodeOfferRecord {
  return nodeOfferFromDraftInput(
    {
      tenant_id: "tenant-acme",
      node_ref: { kind: "human", id: "body-1" },
      capability_id: "cap-copywriting",
      inputs: [],
      deliverables: ["landing page copy"],
      availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: "2 concurrent" },
      geography: "global",
      language: "en",
      price_reward: { amount: "120.00", currency: "USD" },
      deadline: "2026-12-31T23:59:59Z",
      sla: "48h first draft",
      rights_constraints: [],
      acceptance_evaluator: { evaluator_ref: "eval-1", method: "human review panel" },
      evidence_refs: ["ev-1"],
      delivery_history: [],
      ...overrides,
    },
    { id: "offer-1", now: NOW },
  );
}

/** 全未知草稿（§8 字段全部 null；capability_id 也未知）。 */
function emptyDraft(): NodeOfferRecord {
  return nodeOfferFromDraftInput(
    {
      tenant_id: "tenant-acme",
      node_ref: { kind: "human", id: "body-1" },
      capability_id: null,
      inputs: null,
      deliverables: null,
      availability: null,
      geography: null,
      language: null,
      price_reward: null,
      deadline: null,
      sla: null,
      rights_constraints: null,
      acceptance_evaluator: null,
      evidence_refs: null,
      delivery_history: null,
    },
    { id: "offer-2", now: NOW },
  );
}

describe("missingOfferDisclosures (§8 gate, pure)", () => {
  test("fully disclosed draft has no missing disclosures", () => {
    expect(missingOfferDisclosures(disclosedDraft())).toEqual([]);
  });

  test("explicit-empty inputs/rights_constraints/delivery_history count as disclosed none", () => {
    const record = disclosedDraft({
      inputs: [],
      rights_constraints: [],
      delivery_history: [],
    });
    const missing = missingOfferDisclosures(record);
    expect(missing).not.toContain("inputs");
    expect(missing).not.toContain("rights_constraints");
    expect(missing).not.toContain("delivery_history");
  });

  test("all-unknown draft names exactly NODE_OFFER_REQUIRED_DISCLOSURES in order", () => {
    const missing = missingOfferDisclosures(emptyDraft());
    expect(missing).toEqual([...NODE_OFFER_REQUIRED_DISCLOSURES]);
  });

  test("empty deliverables/evidence_refs count as missing (unlike rights_constraints)", () => {
    const record = disclosedDraft({ deliverables: [], evidence_refs: [] });
    expect(missingOfferDisclosures(record)).toEqual(["deliverables", "evidence_refs"]);
  });

  test("null rights_constraints/delivery_history count as missing (null != explicit none)", () => {
    const record = disclosedDraft({ rights_constraints: null, delivery_history: null });
    expect(missingOfferDisclosures(record)).toEqual([
      "rights_constraints",
      "delivery_history",
    ]);
  });

  test("availability missing only when the whole object or both windows and capacity are null", () => {
    expect(missingOfferDisclosures(disclosedDraft({ availability: null }))).toEqual([
      "availability",
    ]);
    expect(
      missingOfferDisclosures(
        disclosedDraft({ availability: { windows: null, capacity: null } }),
      ),
    ).toEqual(["availability"]);
    // 只披露其一（部分披露）即视为已披露可用性。
    expect(
      missingOfferDisclosures(
        disclosedDraft({ availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: null } }),
      ),
    ).toEqual([]);
    expect(
      missingOfferDisclosures(
        disclosedDraft({ availability: { windows: null, capacity: "2 concurrent" } }),
      ),
    ).toEqual([]);
  });

  test("whitespace-only capability_id / evaluator_ref count as missing (defense in depth)", () => {
    expect(missingOfferDisclosures(disclosedDraft({ capability_id: " " }))).toEqual([
      "capability_id",
    ]);
    expect(
      missingOfferDisclosures(
        disclosedDraft({ acceptance_evaluator: { evaluator_ref: " ", method: "panel" } }),
      ),
    ).toEqual(["acceptance_evaluator"]);
  });

  test("single null §8 field is named exactly (no more, no less)", () => {
    expect(missingOfferDisclosures(disclosedDraft({ geography: null }))).toEqual([
      "geography",
    ]);
    expect(missingOfferDisclosures(disclosedDraft({ price_reward: null }))).toEqual([
      "price_reward",
    ]);
  });

  test("never mutates the input record", () => {
    const record = emptyDraft();
    const snapshot = structuredClone(record);
    missingOfferDisclosures(record);
    expect(record).toEqual(snapshot);
  });
});
