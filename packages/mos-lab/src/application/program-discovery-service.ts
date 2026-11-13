import { InvariantViolation, parseOrFail } from "@mos/contracts";
import type { Hypothesis, NodeOffer } from "@mos/contracts";
import {
  HypothesisNotFoundError,
  MissionNotFoundError,
} from "../contract/hypothesis.js";
import type { MissionLookup } from "../contract/hypothesis.js";
import {
  programDiscoveryInputSchema,
  RouteNotFoundError,
} from "../contract/program-discovery.js";
import type {
  HypothesisLookup,
  LabProgramSuggestion,
  OfferLookup,
  ProgramDiscoveryInput,
  RouteCandidateFact,
  RouteLookup,
} from "../contract/program-discovery.js";
import type { TimePort } from "../contract/lab-vocabulary.js";
import {
  deriveProgramSuggestions,
  isSuggestibleRouteClass,
} from "../domain/program-discovery.js";

/**
 * Program discovery 服务：结构化 lookup 端口编排 + 领域纯推导器的薄封装。
 *
 * - fail-closed（未知引用一律类型化错误，绝不猜测）：
 *   - missionLookup 未命中 → MissionNotFoundError（他租户 mission 与不存在同义）；
 *   - hypothesisLookup 未命中 → HypothesisNotFoundError；
 *   - routeLookup 未命中 → RouteNotFoundError；
 *   - 端口返回的假设不属于（tenant, mission）→ InvariantViolation（坏端口防御，
 *     领域推导器还会对全部记录复检一次）。
 * - offerLookup 只为可建议（existing/conditional）路由引用的 capability 调用——
 *   blocked/unknown 路由永不进入 route_refs，不为其消耗 offer 查找。
 * - created_at 经注入 TimePort；推导本身零 I/O、零 engine/provider/LLM 调用（决策锁 #9）。
 */
export interface ProgramDiscoveryServiceDeps {
  /** 推导时间锚点来源（RFC3339 UTC；created_at 一律经端口获得）。 */
  readonly time: TimePort;
  /** mission 查找端口（与 HypothesisStore 共用同一结构性端口形状）。 */
  readonly missionLookup: MissionLookup;
  /** 假设查找端口。 */
  readonly hypothesisLookup: HypothesisLookup;
  /** 路由查找端口（返回既有 Route 记录 + 组合根解析好的 capability_ids 配对）。 */
  readonly routeLookup: RouteLookup;
  /** offer 查找端口（按 capability 返回 offer 记录，可为空数组）。 */
  readonly offerLookup: OfferLookup;
}

export class ProgramDiscoveryService {
  private readonly time: TimePort;
  private readonly missionLookup: MissionLookup;
  private readonly hypothesisLookup: HypothesisLookup;
  private readonly routeLookup: RouteLookup;
  private readonly offerLookup: OfferLookup;

  constructor(deps: ProgramDiscoveryServiceDeps) {
    this.time = deps.time;
    this.missionLookup = deps.missionLookup;
    this.hypothesisLookup = deps.hypothesisLookup;
    this.routeLookup = deps.routeLookup;
    this.offerLookup = deps.offerLookup;
  }

  /** 为点名假设集合推导 lab program suggestions（引用、绝不复制既有 route/offer 记录）。 */
  discover(input: ProgramDiscoveryInput): readonly LabProgramSuggestion[] {
    const parsed = parseOrFail(
      "ProgramDiscoveryInput",
      programDiscoveryInputSchema,
      input,
    );

    const mission = this.missionLookup(parsed.tenant_id, parsed.mission_id);
    if (mission === undefined) {
      throw new MissionNotFoundError(parsed.tenant_id, parsed.mission_id);
    }
    if (mission.tenant_id !== parsed.tenant_id) {
      // 坏端口防御：领域推导器对全部记录还会复检一次 tenant 范围。
      throw new InvariantViolation(
        "program-discovery-scope",
        `mission ${parsed.mission_id} 的 tenant (${mission.tenant_id}) 与调用方 tenant (${parsed.tenant_id}) 不一致`,
      );
    }

    const hypotheses: Hypothesis[] = [];
    for (const hypothesisId of parsed.hypothesis_ids) {
      const hypothesis = this.hypothesisLookup(parsed.tenant_id, hypothesisId);
      if (hypothesis === undefined) {
        throw new HypothesisNotFoundError(parsed.tenant_id, hypothesisId);
      }
      if (
        hypothesis.tenant_id !== parsed.tenant_id ||
        hypothesis.mission_id !== parsed.mission_id
      ) {
        throw new InvariantViolation(
          "program-discovery-scope",
          `假设 ${hypothesisId} 不属于 (tenant=${parsed.tenant_id}, mission=${parsed.mission_id})`,
        );
      }
      hypotheses.push(hypothesis);
    }

    const routeCandidates: RouteCandidateFact[] = [];
    for (const routeId of uniqueIds(
      hypotheses.flatMap((hypothesis) => [...hypothesis.proposed_route_ids]),
    )) {
      const fact = this.routeLookup(parsed.tenant_id, routeId);
      if (fact === undefined) {
        throw new RouteNotFoundError(parsed.tenant_id, routeId);
      }
      routeCandidates.push(fact);
    }

    // 只为可建议路由引用的 capability 查找 offer（blocked/unknown 路由不消耗查找）。
    const offersByCapability = new Map<string, readonly NodeOffer[]>();
    for (const capabilityId of uniqueIds(
      routeCandidates
        .filter((fact) => isSuggestibleRouteClass(fact.route.route_class))
        .flatMap((fact) => [...fact.capability_ids]),
    )) {
      offersByCapability.set(
        capabilityId,
        this.offerLookup(parsed.tenant_id, capabilityId),
      );
    }

    return deriveProgramSuggestions({
      mission,
      hypotheses,
      routeCandidates,
      offersByCapability,
      now: this.time.now(),
    });
  }
}

/** 顺序保持的 id 去重（同一引用只解析一次端口）。 */
function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}
