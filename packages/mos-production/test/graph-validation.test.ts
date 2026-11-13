import { describe, expect, test } from "vitest";
import type { ProductionGraph } from "@mos/contracts";
import { validateGraph } from "../src/index.js";
import type { EngineLookup, TransformLookup } from "../src/index.js";

/**
 * validateGraph 矩阵（纯函数）：合法图通过、环/孤儿/未解析引用/非 active 状态
 * 全部具名拒绝、错误全量收集（绝不静默丢弃）。
 */

const NOW = "2026-11-13T00:00:00Z";
const TENANT = "tenant-acme";
const OTHER_TENANT = "tenant-globex";

/** 三节点链（transform → engine → review_gate）——合法基准图。 */
function baseGraph(overrides: Partial<ProductionGraph> = {}): ProductionGraph {
  return {
    id: "graph-1",
    tenant_id: TENANT,
    mission_id: null,
    version: 1,
    name: "caption then review",
    nodes: [
      { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
      { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
      { id: "n3", kind: "review_gate", ref: null, parameters: {} },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
    status: "draft",
    validated_at: null,
    validation_errors: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** 端口事实集：transform / engine 状态按 (tenant, id) 解析。 */
const TRANSFORMS: ReadonlyArray<{ id: string; tenant_id: string; status: "active" | "draft" | "retired" }> = [
  { id: "tr-caption", tenant_id: TENANT, status: "active" },
  { id: "tr-draft", tenant_id: TENANT, status: "draft" },
  { id: "tr-retired", tenant_id: TENANT, status: "retired" },
  { id: "tr-other", tenant_id: OTHER_TENANT, status: "active" },
];
const ENGINES: ReadonlyArray<{ id: string; tenant_id: string; status: "registered" | "benchmarked" | "deprecated" | "unknown" }> = [
  { id: "engine-local", tenant_id: TENANT, status: "registered" },
  { id: "engine-bench", tenant_id: TENANT, status: "benchmarked" },
  { id: "engine-deprecated", tenant_id: TENANT, status: "deprecated" },
  { id: "engine-unknown", tenant_id: TENANT, status: "unknown" },
  { id: "engine-other", tenant_id: OTHER_TENANT, status: "registered" },
];

const transformLookup: TransformLookup = (tenantId, transformId) => {
  const found = TRANSFORMS.find((item) => item.id === transformId);
  if (found === undefined || found.tenant_id !== tenantId) return undefined;
  return { status: found.status };
};
const engineLookup: EngineLookup = (tenantId, engineId) => {
  const found = ENGINES.find((item) => item.id === engineId);
  if (found === undefined || found.tenant_id !== tenantId) return undefined;
  return { status: found.status };
};

function run(graph: ProductionGraph) {
  return validateGraph({ graph, transformLookup, engineLookup });
}

describe("validateGraph (structural checks)", () => {
  test("valid 3-node graph validates with no errors", () => {
    const result = run(baseGraph());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("diamond DAG (multiple paths, no false cycle) validates", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "a", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "b", kind: "human", ref: null, parameters: {} },
          { id: "c", kind: "human", ref: null, parameters: {} },
          { id: "d", kind: "review_gate", ref: null, parameters: {} },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "d" },
          { from: "c", to: "d" },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  test("cycle detection produces a named error with the full cycle path", () => {
    const result = run(
      baseGraph({
        edges: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n1" },
          { from: "n2", to: "n3" },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("cycle detected: n1 -> n2 -> n1");
  });

  test("self-loop is reported as a cycle", () => {
    const result = run(
      baseGraph({
        nodes: [{ id: "n1", kind: "human", ref: null, parameters: {} }],
        edges: [{ from: "n1", to: "n1" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("cycle detected: n1 -> n1");
  });

  test("orphan node produces a named error", () => {
    const result = run(
      baseGraph({
        nodes: [
          ...baseGraph().nodes,
          { id: "n4", kind: "budget", ref: null, parameters: {} },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "orphan node: n4 (no incoming or outgoing edges; single-node graphs are the only exception)",
    );
  });

  test("single-node graph without edges is not an orphan (explicit exception)", () => {
    const result = run(
      baseGraph({
        nodes: [{ id: "n1", kind: "transform", ref: "tr-caption", parameters: {} }],
        edges: [],
      }),
    );
    expect(result.valid).toBe(true);
  });

  test("empty node set is rejected with a named error (fail-closed addition)", () => {
    const result = run(baseGraph({ nodes: [], edges: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith("graph has no nodes"))).toBe(true);
  });

  test("duplicate node ids are named", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "human", ref: null, parameters: {} },
          { id: "n1", kind: "human", ref: null, parameters: {} },
          { id: "n2", kind: "human", ref: null, parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("duplicate node id: n1");
  });

  test("edges referencing unknown nodes are named per endpoint", () => {
    const result = run(
      baseGraph({
        edges: [
          { from: "n1", to: "n9" },
          { from: "n8", to: "n2" },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("edge n1 -> n9 references unknown node: n9");
    expect(result.errors).toContain("edge n8 -> n2 references unknown node: n8");
  });
});

describe("validateGraph (reference checks via injected lookup ports)", () => {
  test("unresolved transform ref produces a named error carrying the ref", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-missing", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unresolved transform ref: tr-missing (node n1)");
  });

  test("transform node with null ref is an unresolved reference (named)", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: null, parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("transform node n1 has no ref: unresolved transform reference");
  });

  test("retired transform blocks validation with a named status error", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-retired", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "transform not active: tr-retired status=retired (node n1)",
    );
  });

  test("draft transform blocks validation with a named status error", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-draft", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("transform not active: tr-draft status=draft (node n1)");
  });

  test("deprecated engine blocks validation with a named status error", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-deprecated", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "engine not usable: engine-deprecated status=deprecated (node n2)",
    );
  });

  test("unknown-status engine blocks validation (fail-closed on unknown)", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-unknown", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("engine not usable: engine-unknown status=unknown (node n2)");
  });

  test("unresolved engine ref produces a named error carrying the ref", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-missing", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unresolved engine ref: engine-missing (node n2)");
  });

  test("engine node with null ref is an unresolved reference (named)", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "n2", kind: "engine", ref: null, parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("engine node n2 has no ref: unresolved engine reference");
  });

  test("other tenant's transform is indistinguishable from a missing one (tenant-scoped port)", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-other", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-local", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unresolved transform ref: tr-other (node n1)");
  });

  test("other tenant's engine is indistinguishable from a missing one (tenant-scoped port)", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-caption", parameters: {} },
          { id: "n2", kind: "engine", ref: "engine-other", parameters: {} },
        ],
        edges: [{ from: "n1", to: "n2" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unresolved engine ref: engine-other (node n2)");
  });

  test("non-referencing node kinds (human/review_gate/budget/deadline) accept null refs", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "human", ref: null, parameters: {} },
          { id: "n2", kind: "review_gate", ref: null, parameters: {} },
          { id: "n3", kind: "budget", ref: null, parameters: {} },
          { id: "n4", kind: "deadline", ref: null, parameters: {} },
        ],
        edges: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n3" },
          { from: "n3", to: "n4" },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateGraph (all errors collected, never silently dropped)", () => {
  test("multiple problems are all named in one pass", () => {
    const result = run(
      baseGraph({
        nodes: [
          { id: "n1", kind: "transform", ref: "tr-draft", parameters: {} },
          { id: "n1", kind: "engine", ref: "engine-missing", parameters: {} },
          { id: "n5", kind: "budget", ref: null, parameters: {} },
        ],
        edges: [
          { from: "n1", to: "n2" },
          { from: "n1", to: "n9" },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("duplicate node id: n1");
    expect(result.errors).toContain("edge n1 -> n9 references unknown node: n9");
    expect(result.errors).toContain("orphan node: n5 (no incoming or outgoing edges; single-node graphs are the only exception)");
    expect(result.errors).toContain("transform not active: tr-draft status=draft (node n1)");
    expect(result.errors).toContain("unresolved engine ref: engine-missing (node n1)");
  });

  test("does not mutate the input graph (pure)", () => {
    const graph = baseGraph();
    const snapshot = JSON.parse(JSON.stringify(graph)) as ProductionGraph;
    run(graph);
    expect(graph).toEqual(snapshot);
  });
});
