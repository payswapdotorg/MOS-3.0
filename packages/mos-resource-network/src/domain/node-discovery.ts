import { assertDiscoverySurfacesExclusions } from "@mos/contracts";
import type { Engine, NetworkNode, NodeOffer } from "@mos/contracts";

/**
 * 网络容量发现（纯函数）：对单一 capability 聚合 network nodes / node offers / engines，
 * matched 与 excluded 二分（§26：被排除容量必须带具名原因浮出，绝不静默过滤 ——
 * 与 @mos/engines 的 deprecated-engines-surfaced 同一诚实暴露惯例）。
 * 非该 capability 的记录不参与（超出查询范围，不属于"被排除容量"）。
 */

export type DiscoveredCapacityKind = "network_node" | "node_offer" | "engine";

export interface MatchedCapacity {
  readonly kind: DiscoveredCapacityKind;
  readonly ref: string;
  readonly node: NetworkNode | null;
  readonly offer: NodeOffer | null;
  readonly engine: Engine | null;
}

export interface ExcludedCapacity {
  readonly kind: DiscoveredCapacityKind;
  readonly ref: string;
  readonly reason: string;
}

export interface DiscoveredCapacity {
  readonly capabilityId: string;
  readonly matched: readonly MatchedCapacity[];
  readonly excluded: readonly ExcludedCapacity[];
  /** matched 与 excluded 都为空 = 该能力无任何容量登记（显式，绝不猜测）。 */
  readonly noCapacityRegistered: boolean;
}

function nodeMatchesCapability(node: NetworkNode, capabilityId: string): boolean {
  return node.evidenced_capability_ids.includes(capabilityId);
}

function offerMatchesCapability(offer: NodeOffer, capabilityId: string): boolean {
  return offer.capability_id === capabilityId;
}

function engineMatchesCapability(engine: Engine, capabilityId: string): boolean {
  return engine.capability_ids.includes(capabilityId);
}

/** 发现输入：全部为已按 tenant 过滤的记录集合（组合根/调用方注入，领域层零 I/O）。 */
export function discoverCapacityForCapability(input: {
  readonly nodes: readonly NetworkNode[];
  readonly offers: readonly NodeOffer[];
  readonly engines: readonly Engine[];
  readonly capabilityId: string;
}): DiscoveredCapacity {
  const matched: MatchedCapacity[] = [];
  const excluded: ExcludedCapacity[] = [];

  for (const node of input.nodes) {
    if (!nodeMatchesCapability(node, input.capabilityId)) continue;
    if (node.status === "active") {
      matched.push({ kind: "network_node", ref: node.id, node, offer: null, engine: null });
    } else {
      excluded.push({
        kind: "network_node",
        ref: node.id,
        reason: `network node ${node.status}`,
      });
    }
  }

  for (const offer of input.offers) {
    if (!offerMatchesCapability(offer, input.capabilityId)) continue;
    if (offer.status === "published") {
      matched.push({ kind: "node_offer", ref: offer.id, node: null, offer, engine: null });
    } else {
      excluded.push({ kind: "node_offer", ref: offer.id, reason: `offer ${offer.status}` });
    }
  }

  for (const engine of input.engines) {
    if (!engineMatchesCapability(engine, input.capabilityId)) continue;
    if (engine.status === "registered" || engine.status === "benchmarked") {
      matched.push({ kind: "engine", ref: engine.id, node: null, offer: null, engine });
    } else {
      excluded.push({ kind: "engine", ref: engine.id, reason: `engine ${engine.status}` });
    }
  }

  // 不变量 §26 终守卫（defense in depth）：排除项无具名原因 = 隐藏，fail-closed。
  assertDiscoverySurfacesExclusions(
    excluded.map((item) => ({ ref: item.ref, reason: item.reason })),
  );

  return {
    capabilityId: input.capabilityId,
    matched,
    excluded,
    noCapacityRegistered: matched.length === 0 && excluded.length === 0,
  };
}
