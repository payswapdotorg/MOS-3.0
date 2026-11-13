import { describe, expect, test } from "vitest";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import type { Hypothesis, Mission, NodeOffer, Route } from "@mos/contracts";
import {
  deriveProgramSuggestions,
  HypothesisNotFoundError,
  labProgramSuggestionSchema,
  MissionNotFoundError,
  ProgramDiscoveryService,
  RouteNotFoundError,
} from "../src/index.js";
import type {
  DeriveProgramSuggestionsInput,
  HypothesisLookup,
  MissionLookup,
  OfferLookup,
  RouteCandidateFact,
  RouteLookup,
  TimePort,
} from "../src/index.js";
import {
  baseHypothesis,
  baseMission,
  baseOffer,
  baseRoute,
  CAP_COPYWRITING,
  CAP_DESIGN,
  MISSION_ID,
  NOW,
  OTHER_TENANT,
  TENANT,
} from "./fixtures.js";

/**
 * Program discovery 矩阵：纯推导器（零 fabrication、缺口显式）+ 服务端口编排
 * （fail-closed 类型化错误）。
 */

function derive(overrides: Partial<DeriveProgramSuggestionsInput> = {}) {
  return deriveProgramSuggestions({
    mission: baseMission(),
    hypotheses: [baseHypothesis()],
    routeCandidates: [],
    offersByCapability: new Map<string, readonly NodeOffer[]>(),
    now: NOW,
    ...overrides,
  });
}

function fact(route: Route, capabilityIds: readonly string[]): RouteCandidateFact {
  return { route, capability_ids: [...capabilityIds] };
}

describe("deriveProgramSuggestions (pure derivation, zero fabrication)", () => {
  test("existing + conditional routes with published matching offers produce a suggestion", () => {
    const routeExisting = baseRoute({ id: "route:1", route_class: "existing" });
    const routeConditional = baseRoute({
      id: "route:2",
      route_class: "conditional",
      preconditions: ["scope:crm.objects.contacts.read"],
    });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:1", "route:2"] });
    const offer = baseOffer({ id: "offer:1" });

    const suggestions = derive({
      hypotheses: [hypothesis],
      routeCandidates: [
        fact(routeExisting, [CAP_COPYWRITING]),
        fact(routeConditional, [CAP_COPYWRITING]),
      ],
      offersByCapability: new Map([[CAP_COPYWRITING, [offer]]]),
    });

    expect(suggestions).toHaveLength(1);
    const [suggestion] = suggestions;
    expect(suggestion?.route_refs).toEqual(["route:1", "route:2"]);
    expect(suggestion?.offer_refs).toEqual(["offer:1"]);
    expect(suggestion?.missing_preconditions).toEqual([]);
    expect(suggestion?.id).toBe(`lab-program:${MISSION_ID}:hyp-1`);
    expect(suggestion?.tenant_id).toBe(TENANT);
    expect(suggestion?.mission_id).toBe(MISSION_ID);
    expect(suggestion?.hypothesis_id).toBe("hyp-1");
    expect(suggestion?.created_at).toBe(NOW);
  });

  test("blocked and unknown routes surface explicitly in missing_preconditions, never in route_refs", () => {
    const blocked = baseRoute({ id: "route:b", route_class: "blocked" });
    const unknown = baseRoute({ id: "route:u", route_class: "unknown" });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: [blocked.id, unknown.id] });

    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(blocked, []), fact(unknown, [])],
    });

    expect(suggestion?.route_refs).toEqual([]);
    expect(suggestion?.offer_refs).toEqual([]);
    expect(suggestion?.missing_preconditions).toEqual([
      "route route:b not actionable: route_class:blocked",
      "route route:u not actionable: route_class:unknown",
    ]);
  });

  test("opportunity_constrained routes surface explicitly too (never silently dropped)", () => {
    const constrained = baseRoute({ id: "route:o", route_class: "opportunity_constrained" });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: [constrained.id] });
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(constrained, [CAP_COPYWRITING])],
      offersByCapability: new Map([[CAP_COPYWRITING, [baseOffer()]]]),
    });
    expect(suggestion?.route_refs).toEqual([]);
    expect(suggestion?.missing_preconditions).toEqual([
      "route route:o not actionable: route_class:opportunity_constrained",
    ]);
  });

  test("a capability without any published offer surfaces explicitly (absent key)", () => {
    const route = baseRoute({ id: "route:1", route_class: "existing" });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:1"] });
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(route, [CAP_DESIGN])],
      offersByCapability: new Map(),
    });
    expect(suggestion?.route_refs).toEqual(["route:1"]);
    expect(suggestion?.offer_refs).toEqual([]);
    expect(suggestion?.missing_preconditions).toEqual([
      `no published offer for capability ${CAP_DESIGN}`,
    ]);
  });

  test("draft/withdrawn/expired offers are never referenced; only published ones match", () => {
    const route = baseRoute({ id: "route:1", route_class: "existing" });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:1"] });
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(route, [CAP_COPYWRITING])],
      offersByCapability: new Map([
        [
          CAP_COPYWRITING,
          [
            baseOffer({ id: "offer:draft", status: "draft" }),
            baseOffer({ id: "offer:withdrawn", status: "withdrawn" }),
            baseOffer({ id: "offer:expired", status: "expired" }),
            baseOffer({ id: "offer:unknown", status: "unknown" }),
            baseOffer({ id: "offer:published", status: "published" }),
          ],
        ],
      ]),
    });
    expect(suggestion?.offer_refs).toEqual(["offer:published"]);
    expect(suggestion?.missing_preconditions).toEqual([]);
  });

  test("a route referencing multiple capabilities: mixed offers and explicit gaps", () => {
    const route = baseRoute({ id: "route:1", route_class: "conditional" });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:1"] });
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(route, [CAP_COPYWRITING, CAP_DESIGN])],
      offersByCapability: new Map([
        [CAP_COPYWRITING, [baseOffer({ id: "offer:copy" })]],
        [CAP_DESIGN, [baseOffer({ id: "offer:design-draft", status: "draft" })]],
      ]),
    });
    expect(suggestion?.route_refs).toEqual(["route:1"]);
    expect(suggestion?.offer_refs).toEqual(["offer:copy"]);
    expect(suggestion?.missing_preconditions).toEqual([
      `no published offer for capability ${CAP_DESIGN}`,
    ]);
  });

  test("references dedupe across routes (offer ids and gap markers keep first-seen order)", () => {
    const first = baseRoute({ id: "route:1", route_class: "existing" });
    const second = baseRoute({ id: "route:2", route_class: "conditional" });
    const hypothesis = baseHypothesis(
      {},
      { proposed_route_ids: ["route:1", "route:2", "route:1"] },
    );
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(first, [CAP_DESIGN]), fact(second, [CAP_DESIGN])],
      offersByCapability: new Map([[CAP_DESIGN, [baseOffer({ id: "offer:design" })]]]),
    });
    expect(suggestion?.route_refs).toEqual(["route:1", "route:2"]);
    expect(suggestion?.offer_refs).toEqual(["offer:design"]);
  });

  test("a hypothesis without proposed routes surfaces the explicit no_proposed_routes marker", () => {
    const [suggestion] = derive({ hypotheses: [baseHypothesis()] });
    expect(suggestion?.route_refs).toEqual([]);
    expect(suggestion?.offer_refs).toEqual([]);
    expect(suggestion?.missing_preconditions).toEqual(["no_proposed_routes"]);
  });

  test("a no-op route without capability references is suggested with no offer matching and no gap", () => {
    const noOp = baseRoute({ id: "route:noop", route_class: "existing", steps: [] });
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:noop"] });
    const [suggestion] = derive({
      hypotheses: [hypothesis],
      routeCandidates: [fact(noOp, [])],
    });
    expect(suggestion?.route_refs).toEqual(["route:noop"]);
    expect(suggestion?.offer_refs).toEqual([]);
    expect(suggestion?.missing_preconditions).toEqual([]);
  });

  test("every suggestion references only ids that were passed in (mixed matrix)", () => {
    const candidateRouteIds = ["route:existing", "route:conditional"];
    const passedOfferIds = ["offer:copy-1", "offer:design-1"];
    const suggestions = derive({
      hypotheses: [
        baseHypothesis({}, { proposed_route_ids: candidateRouteIds }),
        baseHypothesis(
          { id: "hyp-2" },
          { proposed_route_ids: ["route:blocked", "route:unknown"] },
        ),
      ],
      routeCandidates: [
        fact(baseRoute({ id: "route:existing", route_class: "existing" }), [CAP_COPYWRITING]),
        fact(baseRoute({ id: "route:conditional", route_class: "conditional" }), [CAP_DESIGN]),
        fact(baseRoute({ id: "route:blocked", route_class: "blocked" }), [CAP_COPYWRITING]),
        fact(baseRoute({ id: "route:unknown", route_class: "unknown" }), [CAP_DESIGN]),
      ],
      offersByCapability: new Map([
        [CAP_COPYWRITING, [baseOffer({ id: "offer:copy-1" })]],
        [CAP_DESIGN, [baseOffer({ id: "offer:design-1" })]],
      ]),
    });

    expect(suggestions).toHaveLength(2);
    for (const suggestion of suggestions) {
      for (const routeRef of suggestion.route_refs) {
        expect(candidateRouteIds).toContain(routeRef);
      }
      for (const offerRef of suggestion.offer_refs) {
        expect(passedOfferIds).toContain(offerRef);
      }
      expect(() => labProgramSuggestionSchema.parse(suggestion)).not.toThrow();
    }
    // 第二条假设（blocked/unknown 路由）只产显式缺口，不引用任何路由。
    expect(suggestions[1]?.route_refs).toEqual([]);
    expect(suggestions[1]?.missing_preconditions).toEqual([
      "route route:blocked not actionable: route_class:blocked",
      "route route:unknown not actionable: route_class:unknown",
    ]);
  });

  test("suggestion ids are deterministic per (mission, hypothesis); created_at equals the injected now", () => {
    const hypothesis = baseHypothesis({}, { proposed_route_ids: ["route:1"] });
    const candidates = [fact(baseRoute({ id: "route:1" }), [])];
    const first = derive({ hypotheses: [hypothesis], routeCandidates: candidates });
    const again = derive({ hypotheses: [hypothesis], routeCandidates: candidates });
    expect(again[0]?.id).toBe(first[0]?.id);
    expect(first[0]?.id).toBe(`lab-program:${MISSION_ID}:hyp-1`);
  });

  test("a hypothesis referencing a route that was not passed in fails closed with RouteNotFoundError", () => {
    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:not-passed-in"] })],
        routeCandidates: [fact(baseRoute({ id: "route:1" }), [])],
      }),
    ).toThrow(RouteNotFoundError);
  });

  test("cross-tenant and cross-mission inputs fail closed with InvariantViolation", () => {
    const foreignHypothesis = baseHypothesis({ tenant_id: OTHER_TENANT }, { tenant_id: OTHER_TENANT });
    expect(() => derive({ hypotheses: [foreignHypothesis] })).toThrow(InvariantViolation);

    const otherMissionHypothesis = baseHypothesis(
      { mission_id: "mos-mission-other" },
      { mission_id: "mos-mission-other" },
    );
    expect(() => derive({ hypotheses: [otherMissionHypothesis] })).toThrow(InvariantViolation);

    const foreignRoute = baseRoute({ id: "route:f", tenant_id: OTHER_TENANT });
    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:f"] })],
        routeCandidates: [fact(foreignRoute, [])],
      }),
    ).toThrow(InvariantViolation);

    const otherMissionRoute = baseRoute({ id: "route:m", mission_id: "mos-mission-other" });
    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:m"] })],
        routeCandidates: [fact(otherMissionRoute, [])],
      }),
    ).toThrow(InvariantViolation);

    const foreignOffer = baseOffer({ id: "offer:f", tenant_id: OTHER_TENANT });
    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:1"] })],
        routeCandidates: [fact(baseRoute({ id: "route:1" }), [CAP_COPYWRITING])],
        offersByCapability: new Map([[CAP_COPYWRITING, [foreignOffer]]]),
      }),
    ).toThrow(InvariantViolation);
  });

  test("duplicate hypothesis / route candidate / offer ids fail closed with InvariantViolation", () => {
    expect(() =>
      derive({ hypotheses: [baseHypothesis(), baseHypothesis()] }),
    ).toThrow(InvariantViolation);

    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:1"] })],
        routeCandidates: [
          fact(baseRoute({ id: "route:1" }), []),
          fact(baseRoute({ id: "route:1", route_class: "conditional" }), []),
        ],
      }),
    ).toThrow(InvariantViolation);

    expect(() =>
      derive({
        hypotheses: [baseHypothesis({}, { proposed_route_ids: ["route:1"] })],
        routeCandidates: [fact(baseRoute({ id: "route:1" }), [CAP_COPYWRITING, CAP_DESIGN])],
        offersByCapability: new Map([
          [CAP_COPYWRITING, [baseOffer({ id: "offer:dup" })]],
          [CAP_DESIGN, [baseOffer({ id: "offer:dup" })]],
        ]),
      }),
    ).toThrow(InvariantViolation);
  });

  test("schema-invalid inputs fail closed with ContractValidationError", () => {
    expect(() => derive({ now: "not-a-timestamp" })).toThrow(ContractValidationError);
    expect(() =>
      derive({
        routeCandidates: [fact(baseRoute({ id: "route:1" }), [])].map((candidate) => ({
          ...candidate,
          capability_ids: [""],
        })),
      }),
    ).toThrow(ContractValidationError);
  });
});

describe("ProgramDiscoveryService (port orchestration, fail-closed on unknown references)", () => {
  const clock: TimePort = { now: () => NOW };

  interface PortWorld {
    missions: Mission[];
    hypotheses: Hypothesis[];
    routeFacts: RouteCandidateFact[];
    offersByCapability: Map<string, NodeOffer[]>;
  }

  function defaultWorld(): PortWorld {
    return {
      missions: [baseMission()],
      hypotheses: [
        baseHypothesis({}, { proposed_route_ids: ["route:1", "route:2"] }),
        baseHypothesis({ id: "hyp-2" }, { proposed_route_ids: ["route:3"] }),
      ],
      routeFacts: [
        fact(baseRoute({ id: "route:1", route_class: "existing" }), [CAP_COPYWRITING]),
        fact(baseRoute({ id: "route:2", route_class: "conditional" }), [CAP_DESIGN]),
        // blocked 路由引用一个独有的能力（marketing.seo）：它绝不应触发 offerLookup。
        fact(baseRoute({ id: "route:3", route_class: "blocked" }), ["marketing.seo"]),
      ],
      offersByCapability: new Map([
        [CAP_COPYWRITING, [baseOffer({ id: "offer:copy" })]],
        [CAP_DESIGN, [baseOffer({ id: "offer:design" })]],
      ]),
    };
  }

  function portsOf(world: PortWorld) {
    const missionLookup: MissionLookup = (tenantId, missionId) => {
      const found = world.missions.find((mission) => mission.id === missionId);
      return found !== undefined && found.tenant_id === tenantId ? found : undefined;
    };
    const hypothesisLookup: HypothesisLookup = (tenantId, hypothesisId) => {
      const found = world.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId);
      return found !== undefined && found.tenant_id === tenantId ? found : undefined;
    };
    const routeLookup: RouteLookup = (tenantId, routeId) => {
      const found = world.routeFacts.find((candidate) => candidate.route.id === routeId);
      return found !== undefined && found.route.tenant_id === tenantId ? found : undefined;
    };
    return { missionLookup, hypothesisLookup, routeLookup };
  }

  function serviceOf(world: PortWorld, offerCalls?: string[]) {
    const { missionLookup, hypothesisLookup, routeLookup } = portsOf(world);
    const offerLookup: OfferLookup = (tenantId, capabilityId) => {
      offerCalls?.push(`${tenantId}:${capabilityId}`);
      return (world.offersByCapability.get(capabilityId) ?? []).filter(
        (offer) => offer.tenant_id === tenantId,
      );
    };
    return new ProgramDiscoveryService({
      time: clock,
      missionLookup,
      hypothesisLookup,
      routeLookup,
      offerLookup,
    });
  }

  test("happy path: resolves records through injected ports and matches the pure derivation", () => {
    const world = defaultWorld();
    const service = serviceOf(world);
    const suggestions = service.discover({
      tenant_id: TENANT,
      mission_id: MISSION_ID,
      hypothesis_ids: ["hyp-1", "hyp-2"],
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]?.route_refs).toEqual(["route:1", "route:2"]);
    expect(suggestions[0]?.offer_refs).toEqual(["offer:copy", "offer:design"]);
    expect(suggestions[0]?.missing_preconditions).toEqual([]);
    expect(suggestions[0]?.created_at).toBe(NOW);
    expect(suggestions[1]?.route_refs).toEqual([]);
    expect(suggestions[1]?.missing_preconditions).toEqual([
      "route route:3 not actionable: route_class:blocked",
    ]);

    // 与纯推导器结果一致（服务只是编排端口，不改判定）。
    expect(suggestions).toEqual(
      deriveProgramSuggestions({
        mission: baseMission(),
        hypotheses: world.hypotheses,
        routeCandidates: world.routeFacts,
        offersByCapability: world.offersByCapability,
        now: NOW,
      }),
    );
  });

  test("unknown mission fails closed with MissionNotFoundError", () => {
    const service = serviceOf(defaultWorld());
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: "mos-mission-missing", hypothesis_ids: ["hyp-1"] }),
    ).toThrow(MissionNotFoundError);
  });

  test("another tenant's mission is indistinguishable from a missing mission", () => {
    const world = defaultWorld();
    world.missions = [baseMission({ tenant_id: OTHER_TENANT })];
    const service = serviceOf(world);
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: ["hyp-1"] }),
    ).toThrow(MissionNotFoundError);
  });

  test("unknown hypothesis fails closed with HypothesisNotFoundError", () => {
    const service = serviceOf(defaultWorld());
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: ["hyp-missing"] }),
    ).toThrow(HypothesisNotFoundError);
  });

  test("unknown route reference fails closed with RouteNotFoundError", () => {
    const world = defaultWorld();
    world.hypotheses = [baseHypothesis({}, { proposed_route_ids: ["route:not-in-port"] })];
    const service = serviceOf(world);
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: ["hyp-1"] }),
    ).toThrow(RouteNotFoundError);
  });

  test("a broken hypothesis port returning a foreign-tenant hypothesis fails closed", () => {
    const world = defaultWorld();
    const { missionLookup, routeLookup } = portsOf(world);
    const brokenHypothesisLookup: HypothesisLookup = (_tenantId, hypothesisId) =>
      world.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId);
    const brokenOfferLookup: OfferLookup = () => [];
    const service = new ProgramDiscoveryService({
      time: clock,
      missionLookup,
      hypothesisLookup: brokenHypothesisLookup,
      routeLookup,
      offerLookup: brokenOfferLookup,
    });
    world.hypotheses = [baseHypothesis({ tenant_id: OTHER_TENANT }, { tenant_id: OTHER_TENANT })];
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: ["hyp-1"] }),
    ).toThrow(InvariantViolation);
  });

  test("a broken hypothesis port returning a hypothesis of another mission fails closed", () => {
    const world = defaultWorld();
    const { missionLookup, routeLookup } = portsOf(world);
    const foreign = baseHypothesis(
      { mission_id: "mos-mission-other" },
      { mission_id: "mos-mission-other" },
    );
    const service = new ProgramDiscoveryService({
      time: clock,
      missionLookup,
      hypothesisLookup: (_tenantId, hypothesisId) =>
        hypothesisId === foreign.id ? foreign : undefined,
      routeLookup,
      offerLookup: () => [],
    });
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: [foreign.id] }),
    ).toThrow(InvariantViolation);
  });

  test("offerLookup is called only for capabilities referenced by suggestible routes", () => {
    const offerCalls: string[] = [];
    const service = serviceOf(defaultWorld(), offerCalls);
    // hyp-1 引用 route:1（existing）与 route:2（conditional）；hyp-2 引用 route:3（blocked）。
    // blocked 路由的独有能力 marketing.seo 绝不触发 offer 查找。
    service.discover({
      tenant_id: TENANT,
      mission_id: MISSION_ID,
      hypothesis_ids: ["hyp-1", "hyp-2"],
    });
    expect(offerCalls).toEqual([`${TENANT}:${CAP_COPYWRITING}`, `${TENANT}:${CAP_DESIGN}`]);
  });

  test("empty hypothesis set yields no suggestions (explicit, honest empty)", () => {
    const service = serviceOf(defaultWorld());
    expect(
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: [] }),
    ).toEqual([]);
  });

  test("duplicate hypothesis ids in the request fail closed with InvariantViolation", () => {
    const service = serviceOf(defaultWorld());
    expect(() =>
      service.discover({ tenant_id: TENANT, mission_id: MISSION_ID, hypothesis_ids: ["hyp-1", "hyp-1"] }),
    ).toThrow(InvariantViolation);
  });

  test("a capability without published offers surfaces the explicit gap through the service too", () => {
    const world = defaultWorld();
    world.offersByCapability.delete(CAP_DESIGN);
    const service = serviceOf(world);
    const suggestions = service.discover({
      tenant_id: TENANT,
      mission_id: MISSION_ID,
      hypothesis_ids: ["hyp-1"],
    });
    expect(suggestions[0]?.route_refs).toEqual(["route:1", "route:2"]);
    expect(suggestions[0]?.offer_refs).toEqual(["offer:copy"]);
    expect(suggestions[0]?.missing_preconditions).toEqual([
      `no published offer for capability ${CAP_DESIGN}`,
    ]);
  });
});
