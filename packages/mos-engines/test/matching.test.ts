import { describe, expect, test } from "vitest";
import type { Engine } from "@mos/contracts";
import { matchEnginesForCapability } from "../src/index.js";

/**
 * matchEnginesForCapability 矩阵（纯函数）：registered/benchmarked 匹配、
 * deprecated/unknown 显式排除（绝不静默）、未知能力 = 空匹配但显式区分。
 */

const NOW = "2026-11-13T00:00:00Z";
const CAPTION = "media.caption";
const DUB = "media.dub";

function engine(
  id: string,
  overrides: Partial<Engine> = {},
): Engine {
  return {
    id,
    tenant_id: "tenant-acme",
    version: 1,
    display_name: `Engine ${id}`,
    capability_ids: [CAPTION],
    provider_id: null,
    sandbox_policy: { network_egress: false, filesystem_scope: "workspace", timeout_ms: null },
    benchmark_refs: [],
    license_terms: null,
    cost_model: null,
    status: "registered",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("matchEnginesForCapability (pure)", () => {
  test("matched includes engines with status registered", () => {
    const result = matchEnginesForCapability({
      engines: [engine("engine-reg", { status: "registered" })],
      capabilityId: CAPTION,
    });
    expect(result.matched.map((item) => item.id)).toEqual(["engine-reg"]);
    expect(result.excluded).toEqual([]);
    expect(result.noEngineRegistered).toBe(false);
  });

  test("matched includes engines with status benchmarked", () => {
    const result = matchEnginesForCapability({
      engines: [engine("engine-bench", { status: "benchmarked" })],
      capabilityId: CAPTION,
    });
    expect(result.matched.map((item) => item.id)).toEqual(["engine-bench"]);
    expect(result.noEngineRegistered).toBe(false);
  });

  test("deprecated engines are surfaced separately with reason, never silently matched", () => {
    const result = matchEnginesForCapability({
      engines: [engine("engine-dep", { status: "deprecated" })],
      capabilityId: CAPTION,
    });
    expect(result.matched).toEqual([]);
    expect(result.excluded).toEqual([
      { engine: engine("engine-dep", { status: "deprecated" }), reason: "deprecated" },
    ]);
    expect(result.noEngineRegistered).toBe(false);
  });

  test("deprecated engines are never silently hidden even when other engines match", () => {
    const deprecated = engine("engine-dep", { status: "deprecated" });
    const result = matchEnginesForCapability({
      engines: [engine("engine-reg"), deprecated],
      capabilityId: CAPTION,
    });
    expect(result.matched.map((item) => item.id)).toEqual(["engine-reg"]);
    expect(result.excluded).toEqual([{ engine: deprecated, reason: "deprecated" }]);
  });

  test("unknown-status engines covering the capability are excluded with named reason (fail-closed)", () => {
    const result = matchEnginesForCapability({
      engines: [engine("engine-unk", { status: "unknown" })],
      capabilityId: CAPTION,
    });
    expect(result.matched).toEqual([]);
    expect(result.excluded).toEqual([
      { engine: engine("engine-unk", { status: "unknown" }), reason: "unknown_status" },
    ]);
    expect(result.noEngineRegistered).toBe(false);
  });

  test("engines not covering the capability appear in neither list", () => {
    const result = matchEnginesForCapability({
      engines: [
        engine("engine-reg"),
        engine("engine-other", { capability_ids: [DUB], status: "deprecated" }),
      ],
      capabilityId: CAPTION,
    });
    expect(result.matched.map((item) => item.id)).toEqual(["engine-reg"]);
    expect(result.excluded).toEqual([]);
  });

  test("unknown capability: empty matches are not an error and noEngineRegistered is explicit", () => {
    const result = matchEnginesForCapability({
      engines: [engine("engine-reg"), engine("engine-dep", { status: "deprecated" })],
      capabilityId: "media.nonexistent",
    });
    expect(result.matched).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.noEngineRegistered).toBe(true);
    expect(result.capabilityId).toBe("media.nonexistent");
  });

  test("empty engine set: noEngineRegistered=true (caller can distinguish from exclusions)", () => {
    const result = matchEnginesForCapability({ engines: [], capabilityId: CAPTION });
    expect(result.matched).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.noEngineRegistered).toBe(true);
  });

  test("result echoes capabilityId verbatim and preserves input order", () => {
    const result = matchEnginesForCapability({
      engines: [
        engine("engine-b", { status: "benchmarked" }),
        engine("engine-a", { status: "registered" }),
        engine("engine-z", { status: "deprecated" }),
      ],
      capabilityId: CAPTION,
    });
    expect(result.capabilityId).toBe(CAPTION);
    expect(result.matched.map((item) => item.id)).toEqual(["engine-b", "engine-a"]);
    expect(result.excluded.map((item) => item.engine.id)).toEqual(["engine-z"]);
  });

  test("does not mutate the input engines array (pure)", () => {
    const input = [engine("engine-1"), engine("engine-2", { status: "deprecated" })];
    const snapshot = JSON.parse(JSON.stringify(input)) as Engine[];
    matchEnginesForCapability({ engines: input, capabilityId: CAPTION });
    expect(input).toEqual(snapshot);
  });
});
