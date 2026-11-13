import { describe, expect, test } from "vitest";
import { discoverCapacityForCapability } from "../src/index.js";
import {
  CAPABILITY_ID,
  publishedOffer,
  registeredEngine,
  registeredNode,
} from "./fixtures.js";
import type { NetworkNode } from "@mos/contracts";

const OTHER_CAPABILITY = "media.dub";

describe("discoverCapacityForCapability (§26 honest surfacing, pure)", () => {
  test("active nodes, published offers and matchable engines match", () => {
    const result = discoverCapacityForCapability({
      nodes: [registeredNode()],
      offers: [publishedOffer()],
      engines: [registeredEngine()],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.noCapacityRegistered).toBe(false);
    expect(result.matched.map((item) => item.kind).sort()).toEqual([
      "engine",
      "network_node",
      "node_offer",
    ]);
    expect(result.excluded).toHaveLength(0);
    const nodeMatch = result.matched.find((item) => item.kind === "network_node");
    expect(nodeMatch?.node?.display_name).toBe("Caption review specialist");
    const offerMatch = result.matched.find((item) => item.kind === "node_offer");
    expect(offerMatch?.offer?.id).toBe("offer-1");
    const engineMatch = result.matched.find((item) => item.kind === "engine");
    expect(engineMatch?.engine?.id).toBe("engine-1");
  });

  test("inactive nodes are surfaced as excluded with named reason, never hidden", () => {
    const inactive: NetworkNode = registeredNode({ status: "inactive" });
    const result = discoverCapacityForCapability({
      nodes: [registeredNode(), inactive],
      offers: [],
      engines: [],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.excluded).toEqual([
      { kind: "network_node", ref: "node-1", reason: "network node inactive" },
    ]);
  });

  test("draft/withdrawn/expired offers surface with status reasons", () => {
    const result = discoverCapacityForCapability({
      nodes: [],
      offers: [
        publishedOffer({ id: "offer-draft", status: "draft" }),
        publishedOffer({ id: "offer-withdrawn", status: "withdrawn" }),
        publishedOffer({ id: "offer-expired", status: "expired" }),
      ],
      engines: [],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.excluded.map((item) => item.reason).sort()).toEqual([
      "offer draft",
      "offer expired",
      "offer withdrawn",
    ]);
  });

  test("deprecated engines surface, never silently hidden (engines idiom)", () => {
    const result = discoverCapacityForCapability({
      nodes: [],
      offers: [],
      engines: [registeredEngine({ status: "deprecated" }), registeredEngine({ id: "engine-ok" })],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.matched.map((item) => item.ref)).toEqual(["engine-ok"]);
    expect(result.excluded).toEqual([
      { kind: "engine", ref: "engine-1", reason: "engine deprecated" },
    ]);
  });

  test("records for other capabilities are out of scope, not excluded", () => {
    const result = discoverCapacityForCapability({
      nodes: [
        registeredNode({ id: "node-other", evidenced_capability_ids: [OTHER_CAPABILITY] }),
      ],
      offers: [publishedOffer({ id: "offer-other", capability_id: OTHER_CAPABILITY })],
      engines: [registeredEngine({ id: "engine-other", capability_ids: [OTHER_CAPABILITY] })],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.noCapacityRegistered).toBe(true);
    expect(result.matched).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });

  test("no capacity registered is explicit, never guessed", () => {
    const result = discoverCapacityForCapability({
      nodes: [],
      offers: [],
      engines: [],
      capabilityId: CAPABILITY_ID,
    });
    expect(result.noCapacityRegistered).toBe(true);
    expect(result.capabilityId).toBe(CAPABILITY_ID);
  });
});
