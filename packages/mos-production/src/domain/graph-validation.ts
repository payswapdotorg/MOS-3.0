import type { ProductionGraph, ProductionGraphNode } from "@mos/contracts";
import type { EngineLookup, TransformLookup } from "../contract/graph.js";

/**
 * 生产图校验（纯函数，零 I/O、零 Date/random）。
 *
 * 决策锁 #5：图是“生产程序描述”，不是执行器——校验只看结构完整性与引用可解析性。
 * 决策锁 #9：engine 节点只持不透明 ref，经注入的 EngineLookup 端口解析，
 * 绝不 import @mos/engines。
 *
 * fail-closed 语义：全部错误具名收集（错误串携带节点 id / 引用 id），
 * 绝不静默丢弃、绝不静默修复；valid = errors 为空。
 */

/** 校验结果：valid=false 时 errors 携带全部具名错误（顺序确定）。 */
export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** 图校验输入：图记录 + 两个结构化查找端口。 */
export interface GraphValidationInput {
  readonly graph: ProductionGraph;
  readonly transformLookup: TransformLookup;
  readonly engineLookup: EngineLookup;
}

/**
 * 校验一张生产图：
 * 1. 节点 id 唯一；
 * 2. 边引用的节点 id 存在；
 * 3. 无环（DAG）；
 * 4. 无孤儿节点（无入边也无出边——单节点图除外：单节点即整图，允许无边）；
 * 5. transform 节点 ref 经 TransformLookup 解析且 status=active
 *    （draft/retired/unknown → 具名错误；ref 为 null = 未解析 → 具名错误）；
 * 6. engine 节点 ref 经 EngineLookup 解析且 status 非 deprecated/unknown
 *    （unresolved → 携带 ref 的具名错误；ref 为 null 同样具名错误）。
 * 额外 fail-closed（超出清单的显式加严）：空节点集不是合法生产程序（具名错误）。
 * 错误顺序确定：结构错误（重复 id → 边引用 → 环 → 孤儿）→ 引用错误（transform → engine）。
 */
export function validateGraph(input: GraphValidationInput): GraphValidationResult {
  const errors: string[] = [];
  const graph = input.graph;
  const nodes = graph.nodes;

  if (nodes.length === 0) {
    errors.push("graph has no nodes: an empty node set is not a production program");
  }

  // 1. 节点 id 唯一（按出现顺序点名重复者）。
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      errors.push(`duplicate node id: ${node.id}`);
      continue;
    }
    seen.add(node.id);
  }

  // 2. 边引用的节点 id 必须存在（from/to 逐端点具名）。
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`edge ${edge.from} -> ${edge.to} references unknown node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`edge ${edge.from} -> ${edge.to} references unknown node: ${edge.to}`);
    }
  }

  // 3. 无环（DAG，含自环）。
  errors.push(...detectCycles(nodes, graph.edges));

  // 4. 无孤儿节点：无入边也无出边（单节点图除外）。
  if (nodes.length > 1) {
    const connected = new Set<string>();
    for (const edge of graph.edges) {
      connected.add(edge.from);
      connected.add(edge.to);
    }
    for (const node of nodes) {
      if (!connected.has(node.id)) {
        errors.push(
          `orphan node: ${node.id} (no incoming or outgoing edges; single-node graphs are the only exception)`,
        );
      }
    }
  }

  // 5. transform 节点引用：ref 必须解析且 status=active（draft/retired → 具名错误）。
  for (const node of nodes) {
    if (node.kind !== "transform") continue;
    if (node.ref === null) {
      errors.push(`transform node ${node.id} has no ref: unresolved transform reference`);
      continue;
    }
    const transform = input.transformLookup(graph.tenant_id, node.ref);
    if (transform === undefined) {
      errors.push(`unresolved transform ref: ${node.ref} (node ${node.id})`);
      continue;
    }
    if (transform.status !== "active") {
      errors.push(
        `transform not active: ${node.ref} status=${transform.status} (node ${node.id})`,
      );
    }
  }

  // 6. engine 节点引用：ref 必须解析且 status 非 deprecated/unknown。
  for (const node of nodes) {
    if (node.kind !== "engine") continue;
    if (node.ref === null) {
      errors.push(`engine node ${node.id} has no ref: unresolved engine reference`);
      continue;
    }
    const engine = input.engineLookup(graph.tenant_id, node.ref);
    if (engine === undefined) {
      errors.push(`unresolved engine ref: ${node.ref} (node ${node.id})`);
      continue;
    }
    if (engine.status === "deprecated" || engine.status === "unknown") {
      errors.push(`engine not usable: ${node.ref} status=${engine.status} (node ${node.id})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 环检测：递归三色 DFS；每条环报告形如 `cycle detected: a -> b -> a` 的完整路径（具名、去重）。 */
function detectCycles(
  nodes: readonly ProductionGraphNode[],
  edges: ReadonlyArray<{ from: string; to: string }>,
): string[] {
  // 邻接表：只收录两端点都存在的边（端点缺失的边已在检查 2 具名）。
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
  }

  const errors: string[] = [];
  const reported = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (nodeId: string): void => {
    const currentState = state.get(nodeId);
    if (currentState === "done") return;
    if (currentState === "visiting") {
      // 回边：输出从回边目标起的完整环路径。
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart < 0 ? 0 : cycleStart);
      const key = `${cycle.join("->")}->${nodeId}`;
      if (!reported.has(key)) {
        reported.add(key);
        errors.push(`cycle detected: ${[...cycle, nodeId].join(" -> ")}`);
      }
      return;
    }
    state.set(nodeId, "visiting");
    path.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      visit(next);
    }
    path.pop();
    state.set(nodeId, "done");
  };

  for (const node of nodes) {
    visit(node.id);
  }
  return errors;
}
