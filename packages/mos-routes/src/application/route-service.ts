import { parseOrFail, routeSchema } from "@mos/contracts";
import type { Mission } from "@mos/contracts";
import type { TimePort } from "@mos/capabilities/contract";
import { evaluateRouteCandidates } from "../domain/evaluate-route.js";
import type {
  RouteCandidateEvaluation,
  RouteInstanceFact,
} from "../contract/route-input.js";

/**
 * 服务端固定 id 种子：同一 mission 重复评估产生相同 route id（重评估可对账；
 * 需要按评估轮次命名空间的调用方直接用领域评估器自带 seed）。
 */
const SERVICE_ID_SEED = 1;

export interface RouteServiceDeps {
  /** 评估时间锚点来源（RFC3339 UTC；checked_at/now 一律经端口获得）。 */
  readonly time: TimePort;
}

/**
 * 路由候选服务：注入时钟 + 领域纯评估器的薄封装。
 * 返回前对每条 route 逐条 parseOrFail（fail-closed 双保险；域内已校验一次）。
 * 评估失败（非法输入/tenant 越界）如实抛出——路由评估不是 ZCode 任务路径的
 * 一部分，不存在 graceful-failure 吞错义务。
 */
export class RouteService {
  private readonly time: TimePort;

  constructor(deps: RouteServiceDeps) {
    this.time = deps.time;
  }

  candidatesForMission(
    mission: Mission,
    instances: readonly RouteInstanceFact[],
  ): RouteCandidateEvaluation {
    const evaluation = evaluateRouteCandidates({
      mission,
      capabilityInstances: instances,
      now: this.time.now(),
      idSeed: SERVICE_ID_SEED,
    });
    for (const route of evaluation.routes) {
      parseOrFail("Route", routeSchema, route);
    }
    return evaluation;
  }
}
