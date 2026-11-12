import {
  InvariantViolation,
  missionSchema,
  parseOrFail,
  rfc3339TimestampSchema,
  routeSchema,
} from "@mos/contracts";
import type {
  CapabilityInstance,
  Mission,
  Route,
  RouteClass,
  SideEffect,
} from "@mos/contracts";
import {
  routeIdSeedSchema,
  routeInstanceFactSchema,
} from "../contract/route-input.js";
import type {
  EvaluateRouteCandidatesInput,
  RouteCandidateEvaluation,
  RouteCandidateSummary,
  RouteInstanceFact,
} from "../contract/route-input.js";
import {
  NO_CAPABILITY_INSTANCES_RESOLVED,
  ROUTE_STATUS_CANDIDATE,
  ZCODE_EXISTING_PERMISSIONS,
} from "../contract/route-vocabulary.js";

/**
 * 路由候选评估（纯函数、fail-closed；spec/backlog/week-1-integration.md Stage 2：
 * "Build minimal route candidates: existing, conditional and blocked/unknown as
 * appropriate. Explain missing provider connection, scope, account eligibility
 * or approval without inventing capability."）。
 *
 * 分类规则（first-match，判据全部来自输入事实，绝不发明能力或前提）：
 * 1. side_effect "irreversible" → blocked（W1 没有 irreversible 动作的审批路径；
 *    risks 披露 side_effect:irreversible；即使实例 available 也绝不 existing）。
 * 2. support_status "unsupported" → blocked（terminal 知识状态：前提永远补不齐，
 *    risks 披露 support_status:unsupported）。
 * 3. support_status "unknown" 或 instance.status "unknown" → unknown
 *    （unknowns 抄录实例的 missing_preconditions；未披露时用显式 floor 标记）。
 * 4. instance.status "available" → existing（preconditions []；
 *    side_effect 非 none/read（含 unknown）→ approvals ["zcode_existing_permissions"]，
 *    MOS 不建第二权限系统）。
 * 5. instance.status "unavailable" + missing_preconditions → conditional
 *    （preconditions 逐字抄录：never invented, never dropped）；
 *    unavailable 但实例未披露任何前提 → unknown（无法解释就不假装 conditional）。
 * 6. instance.status "degraded" → conditional（preconditions 逐字抄录；
 *    risks 披露 implementation:degraded）。
 *
 * 其他不变量：
 * - 无任何实例 → 单条 unknown 路由，unknowns ["no_capability_instances_resolved"]
 *   （绝不 blocked、绝不 existing）。
 * - 实例 tenant 与 mission tenant 不一致 → InvariantViolation（fail-closed）。
 * - fallback_route_ids 恒 []（W1 无静默回退）。
 * - 每条产物都经 routeSchema parseOrFail（fail-closed）。
 */

/** 无需审批绑定的副作用：none（无副作用）与 read（只读）。其余一律绑定既有 ZCode 权限。 */
const APPROVAL_FREE_SIDE_EFFECTS: readonly SideEffect[] = ["none", "read"];

export function evaluateRouteCandidates(
  input: EvaluateRouteCandidatesInput,
): RouteCandidateEvaluation {
  const mission = parseOrFail("Mission", missionSchema, input.mission) as Mission;
  // 评估时间锚点：W1 Route 无时间戳字段，先守住 RFC3339 输入纪律（fail-closed）。
  parseOrFail("RouteEvaluationTimestamp", rfc3339TimestampSchema, input.now);
  const idSeed = parseOrFail(
    "RouteEvaluationIdSeed",
    routeIdSeedSchema,
    input.idSeed,
  ) as number;
  const facts = input.capabilityInstances.map(
    (fact) =>
      parseOrFail("RouteInstanceFact", routeInstanceFactSchema, fact) as RouteInstanceFact,
  );

  if (facts.length === 0) {
    const noCapabilityRoute = buildRoute({
      mission,
      idSeed,
      position: 1,
      routeClass: "unknown",
      steps: [],
      preconditions: [],
      approvals: [],
      evidenceRefs: [],
      unknowns: [NO_CAPABILITY_INSTANCES_RESOLVED],
      risks: [],
    });
    return { routes: [noCapabilityRoute], summary: compareRoutes([noCapabilityRoute]) };
  }

  const routes: Route[] = [];
  let position = 0;
  for (const fact of facts) {
    position += 1;
    assertSameTenant(mission, fact.instance);
    routes.push(routeForFact({ mission, fact, idSeed, position }));
  }
  return { routes, summary: compareRoutes(routes) };
}

/** 候选对比：五个 route_class 全部可区分（W1 评估器不产 opportunity_constrained）。 */
export function compareRoutes(routes: readonly Route[]): RouteCandidateSummary {
  const count = (routeClass: RouteClass): number =>
    routes.filter((route) => route.route_class === routeClass).length;
  return {
    total: routes.length,
    existing: count("existing"),
    conditional: count("conditional"),
    opportunity_constrained: count("opportunity_constrained"),
    blocked: count("blocked"),
    unknown: count("unknown"),
  };
}

/** 单条能力事实 → 一条候选路由（first-match 分类，全部判据来自事实）。 */
function routeForFact(parts: {
  mission: Mission;
  fact: RouteInstanceFact;
  idSeed: number;
  position: number;
}): Route {
  const { mission, fact, idSeed, position } = parts;
  const { instance, side_effect } = fact;
  const base = {
    mission,
    idSeed,
    position,
    steps: [stepFor(fact)],
    evidenceRefs: [...instance.evidence_refs],
  };

  if (side_effect === "irreversible") {
    // 明确不安全：W1 没有 irreversible 动作的审批路径 → 绝不放行为 existing。
    return buildRoute({
      ...base,
      routeClass: "blocked",
      preconditions: [],
      approvals: [],
      unknowns: [],
      risks: ["side_effect:irreversible"],
    });
  }

  if (instance.support_status === "unsupported") {
    // terminal 知识状态：能力确认不支持，前提永远补不齐 → blocked（不是 conditional）。
    return buildRoute({
      ...base,
      routeClass: "blocked",
      preconditions: [],
      approvals: [],
      unknowns: [],
      risks: ["support_status:unsupported"],
    });
  }

  if (instance.support_status === "unknown") {
    return buildRoute({
      ...base,
      routeClass: "unknown",
      preconditions: [],
      approvals: [],
      unknowns: unknownsOf(instance, "support_status:unknown"),
      risks: [],
    });
  }

  if (instance.status === "unknown") {
    return buildRoute({
      ...base,
      routeClass: "unknown",
      preconditions: [],
      approvals: [],
      unknowns: unknownsOf(instance, "instance_status:unknown"),
      risks: [],
    });
  }

  if (instance.status === "available") {
    return buildRoute({
      ...base,
      routeClass: "existing",
      preconditions: [],
      approvals: APPROVAL_FREE_SIDE_EFFECTS.includes(side_effect)
        ? []
        : [ZCODE_EXISTING_PERMISSIONS],
      unknowns: [],
      risks: [],
    });
  }

  if (instance.status === "unavailable") {
    if (instance.missing_preconditions.length === 0) {
      // 实例说不可用却不披露前提：无法解释 → unknown，绝不假装 conditional。
      return buildRoute({
        ...base,
        routeClass: "unknown",
        preconditions: [],
        approvals: [],
        unknowns: ["instance_status:unavailable_no_preconditions_disclosed"],
        risks: [],
      });
    }
    return buildRoute({
      ...base,
      routeClass: "conditional",
      preconditions: [...instance.missing_preconditions],
      approvals: [],
      unknowns: [],
      risks: [],
    });
  }

  // 唯一剩余状态 degraded：连接/scope 都满足但实现降级 → conditional + 风险披露。
  return buildRoute({
    ...base,
    routeClass: "conditional",
    preconditions: [...instance.missing_preconditions],
    approvals: [],
    unknowns: [],
    risks: ["implementation:degraded"],
  });
}

/** 步骤披露：动作（能力 + 副作用 + 实例引用）如实陈述，无发明的营销话术。 */
function stepFor(fact: RouteInstanceFact): {
  description: string;
  capability_instance_id: string;
  side_effect: SideEffect;
} {
  return {
    description: `Use capability ${fact.instance.capability_id} (side effect: ${fact.side_effect}) via capability instance ${fact.instance.id}`,
    capability_instance_id: fact.instance.id,
    side_effect: fact.side_effect,
  };
}

/** unknown 路由的 unknowns：抄录实例披露的缺口；实例什么都没披露时用显式 floor 标记。 */
function unknownsOf(instance: CapabilityInstance, floorMarker: string): string[] {
  return instance.missing_preconditions.length > 0
    ? [...instance.missing_preconditions]
    : [floorMarker];
}

/** tenant 边界：实例属于别的 tenant → fail-closed（绝不静默换租户评估）。 */
function assertSameTenant(mission: Mission, instance: CapabilityInstance): void {
  if (instance.tenant_id !== mission.tenant_id) {
    throw new InvariantViolation(
      "route-planning-tenant-scope",
      `能力实例 tenant (${instance.tenant_id}) 与 mission tenant (${mission.tenant_id}) 不一致`,
    );
  }
}

/** 统一组装 + routeSchema 校验（fail-closed；W1 无回退、无成本/时延/置信度猜测）。 */
function buildRoute(parts: {
  mission: Mission;
  idSeed: number;
  position: number;
  routeClass: RouteClass;
  steps: { description: string; capability_instance_id: string; side_effect: SideEffect }[];
  preconditions: string[];
  approvals: string[];
  evidenceRefs: string[];
  unknowns: string[];
  risks: string[];
}): Route {
  return parseOrFail("Route", routeSchema, {
    id: `route:${parts.mission.id}:${parts.idSeed}:${parts.position}`,
    tenant_id: parts.mission.tenant_id,
    mission_id: parts.mission.id,
    route_class: parts.routeClass,
    status: ROUTE_STATUS_CANDIDATE,
    steps: parts.steps,
    preconditions: parts.preconditions,
    approvals: parts.approvals,
    estimated_cost: null,
    estimated_latency_ms: null,
    confidence: null,
    evidence_refs: parts.evidenceRefs,
    unknowns: parts.unknowns,
    risks: parts.risks,
    fallback_route_ids: [],
  }) as Route;
}
