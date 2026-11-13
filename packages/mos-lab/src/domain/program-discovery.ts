import {
  hypothesisSchema,
  InvariantViolation,
  missionSchema,
  nodeOfferSchema,
  parseOrFail,
  rfc3339TimestampSchema,
} from "@mos/contracts";
import type {
  Hypothesis,
  Mission,
  NodeOffer,
  Route,
  RouteClass,
} from "@mos/contracts";
import {
  labProgramSuggestionSchema,
  RouteNotFoundError,
  routeCandidateFactSchema,
} from "../contract/program-discovery.js";
import type {
  DeriveProgramSuggestionsInput,
  LabProgramSuggestion,
  RouteCandidateFact,
} from "../contract/program-discovery.js";
import {
  NO_PROPOSED_ROUTES,
  noPublishedOfferForCapability,
  OFFER_STATUS_PUBLISHED,
  routeNotActionable,
  SUGGESTIBLE_ROUTE_CLASSES,
} from "../contract/lab-vocabulary.js";
import type { SuggestibleRouteClass } from "../contract/lab-vocabulary.js";

/**
 * Program discovery 纯推导器（零 I/O、零 Date/random、零 engine/provider/LLM 调用——决策锁 #9）。
 *
 * 规则（零 fabrication，全部判据来自输入记录；只引用、绝不复制/发明 route 或 offer）：
 * 1. 每条假设产出一个 suggestion（id = `lab-program:<mission_id>:<hypothesis_id>`，
 *    确定性、重推导可对账；created_at = 注入的 now）。
 * 2. 假设 proposed_route_ids 中类别为 existing / conditional 的路由 → route_refs。
 * 3. 可建议路由引用的每个 capability：只有 status=published 的 offer 被引用
 *    （draft / withdrawn / expired / unknown 一律不引用）；无 published offer →
 *    missing_preconditions 显式标记 `no published offer for capability <id>`。
 *    路由未引用任何 capability（含 no-op/复用路由，决策锁 #17）→ 无 offer 匹配、无缺口标记。
 * 4. blocked / unknown / opportunity_constrained 路由 → 绝不进 route_refs，
 *    missing_preconditions 显式标记 `route <id> not actionable: route_class:<class>`
 *    （绝不静默丢弃）。
 * 5. 假设未引用任何路由 → `no_proposed_routes` 显式标记（绝不静默产出无法解释的空程序）。
 * 6. 引用未传入的路由 id（proposed_route_ids ⊄ 候选集）→ RouteNotFoundError（fail-closed）。
 * 7. 输入一致性（fail-closed InvariantViolation）：假设/路由/offer 的 tenant 或 mission
 *    绑定与 mission 不一致；重复的假设/路由/offer id。
 * 8. 产物逐条经 labProgramSuggestionSchema parseOrFail。
 *
 * 假设 status 过滤不在推导内：withdrawn / superseded 假设是否参与发现由调用方（组合根）选择。
 */

/** 判定路由类别是否可建议（只有 existing / conditional 进入 route_refs）。 */
export function isSuggestibleRouteClass(routeClass: RouteClass): routeClass is SuggestibleRouteClass {
  return (SUGGESTIBLE_ROUTE_CLASSES as readonly RouteClass[]).includes(routeClass);
}

export function deriveProgramSuggestions(
  input: DeriveProgramSuggestionsInput,
): readonly LabProgramSuggestion[] {
  const mission = parseOrFail("Mission", missionSchema, input.mission) as Mission;
  parseOrFail("ProgramDiscoveryTimestamp", rfc3339TimestampSchema, input.now);
  const hypotheses = input.hypotheses.map(
    (hypothesis) => parseOrFail("Hypothesis", hypothesisSchema, hypothesis) as Hypothesis,
  );
  const candidates = input.routeCandidates.map(
    (fact) => parseOrFail("RouteCandidateFact", routeCandidateFactSchema, fact) as RouteCandidateFact,
  );
  const offersByCapability = validateOffers(input.offersByCapability, mission);

  assertNoDuplicateIds(hypotheses.map((hypothesis) => hypothesis.id), "hypothesis");
  assertNoDuplicateIds(
    candidates.map((fact) => fact.route.id),
    "route candidate",
  );

  for (const hypothesis of hypotheses) {
    assertHypothesisInMissionScope(mission, hypothesis);
  }
  for (const fact of candidates) {
    assertRouteInMissionScope(mission, fact.route);
  }

  const candidatesById = new Map(candidates.map((fact) => [fact.route.id, fact] as const));

  return hypotheses.map((hypothesis) =>
    suggestionFor({
      mission,
      hypothesis,
      candidatesById,
      offersByCapability,
      now: input.now,
    }),
  );
}

/** 单条假设 → 单个程序建议（缺口一律显式，绝不静默丢弃）。 */
function suggestionFor(parts: {
  mission: Mission;
  hypothesis: Hypothesis;
  candidatesById: ReadonlyMap<string, RouteCandidateFact>;
  offersByCapability: ReadonlyMap<string, readonly NodeOffer[]>;
  now: string;
}): LabProgramSuggestion {
  const { mission, hypothesis, candidatesById, offersByCapability } = parts;

  const routeRefs: string[] = [];
  const offerRefs: string[] = [];
  const missingPreconditions: string[] = [];

  if (hypothesis.proposed_route_ids.length === 0) {
    pushUnique(missingPreconditions, NO_PROPOSED_ROUTES);
  }

  for (const routeId of hypothesis.proposed_route_ids) {
    const fact = candidatesById.get(routeId);
    if (fact === undefined) {
      // fail-closed：假设引用了未传入的路由记录——绝不猜测其类别。
      throw new RouteNotFoundError(mission.tenant_id, routeId, hypothesis.id);
    }
    const routeClass = fact.route.route_class;
    if (!isSuggestibleRouteClass(routeClass)) {
      // blocked / unknown / opportunity_constrained：显式暴露，绝不静默丢弃，绝不进 route_refs。
      pushUnique(missingPreconditions, routeNotActionable(fact.route.id, routeClass));
      continue;
    }
    pushUnique(routeRefs, fact.route.id);
    for (const capabilityId of fact.capability_ids) {
      const published = (offersByCapability.get(capabilityId) ?? []).filter(
        (offer) => offer.status === OFFER_STATUS_PUBLISHED,
      );
      if (published.length === 0) {
        // 无 published offer 的能力：显式缺口（含"只有 draft/withdrawn/expired offer"的情况）。
        pushUnique(missingPreconditions, noPublishedOfferForCapability(capabilityId));
        continue;
      }
      for (const offer of published) {
        pushUnique(offerRefs, offer.id);
      }
    }
  }

  return parseOrFail("LabProgramSuggestion", labProgramSuggestionSchema, {
    id: `lab-program:${mission.id}:${hypothesis.id}`,
    tenant_id: mission.tenant_id,
    mission_id: mission.id,
    hypothesis_id: hypothesis.id,
    route_refs: routeRefs,
    offer_refs: offerRefs,
    missing_preconditions: missingPreconditions,
    created_at: parts.now,
  }) as LabProgramSuggestion;
}

/** offersByCapability 逐条经 nodeOfferSchema 校验 + 重复 id / tenant 范围 fail-closed。 */
function validateOffers(
  offersByCapability: ReadonlyMap<string, readonly NodeOffer[]>,
  mission: Mission,
): ReadonlyMap<string, readonly NodeOffer[]> {
  const seenOfferIds = new Set<string>();
  const validated = new Map<string, readonly NodeOffer[]>();
  for (const [capabilityId, offers] of offersByCapability) {
    const parsed = offers.map((offer) => parseOrFail("NodeOffer", nodeOfferSchema, offer) as NodeOffer);
    for (const offer of parsed) {
      if (offer.tenant_id !== mission.tenant_id) {
        throw new InvariantViolation(
          "program-discovery-scope",
          `offer ${offer.id} 的 tenant (${offer.tenant_id}) 与 mission tenant (${mission.tenant_id}) 不一致`,
        );
      }
      if (seenOfferIds.has(offer.id)) {
        throw new InvariantViolation(
          "program-discovery-input",
          `重复的 offer id: ${offer.id}（同一 offer 不得出现在多个 capability 桶下）`,
        );
      }
      seenOfferIds.add(offer.id);
    }
    validated.set(capabilityId, parsed);
  }
  return validated;
}

/** 假设必须属于同一 mission（tenant + mission 绑定一致），否则 fail-closed。 */
function assertHypothesisInMissionScope(mission: Mission, hypothesis: Hypothesis): void {
  if (hypothesis.tenant_id !== mission.tenant_id) {
    throw new InvariantViolation(
      "program-discovery-scope",
      `假设 ${hypothesis.id} 的 tenant (${hypothesis.tenant_id}) 与 mission tenant (${mission.tenant_id}) 不一致`,
    );
  }
  if (hypothesis.mission_id !== mission.id) {
    throw new InvariantViolation(
      "program-discovery-scope",
      `假设 ${hypothesis.id} 不属于 mission ${mission.id}`,
    );
  }
}

/** 路由候选必须属于同一 mission（tenant + mission 绑定一致），否则 fail-closed。 */
function assertRouteInMissionScope(mission: Mission, route: Route): void {
  if (route.tenant_id !== mission.tenant_id) {
    throw new InvariantViolation(
      "program-discovery-scope",
      `路由 ${route.id} 的 tenant (${route.tenant_id}) 与 mission tenant (${mission.tenant_id}) 不一致`,
    );
  }
  if (route.mission_id !== mission.id) {
    throw new InvariantViolation(
      "program-discovery-scope",
      `路由 ${route.id} 不属于 mission ${mission.id}`,
    );
  }
}

/** 输入 id 重复（同一记录两次传入）→ fail-closed（去重是调用方职责，绝不静默合并）。 */
function assertNoDuplicateIds(ids: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new InvariantViolation(
        "program-discovery-input",
        `重复的 ${what} id: ${id}（同一记录不得重复传入）`,
      );
    }
    seen.add(id);
  }
}

/** 顺序保持的去重追加（引用与缺口标记都保持首次出现顺序、不重复）。 */
function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}
