import { z } from "zod";
import {
  capabilityInstanceSchema,
  sideEffectSchema,
} from "@mos/contracts";
import type { Mission, Route } from "@mos/contracts";

/**
 * 路由候选评估的公共契约（fail-closed）。
 * "不可评估"用 route_class unknown/blocked 表达（不用异常）；
 * 跨 tenant / 非法输入用类型化错误（InvariantViolation / ContractValidationError）。
 */

/**
 * 路由评估的单条能力事实：已解析的账户能力实例 + 描述符声明的副作用。
 * 副作用必须由组合根从能力描述符配对带来——路由评估绝不从 capability_id /
 * implementation_id 猜副作用；描述符未声明时组合根必须如实标注 "unknown"。
 */
export const routeInstanceFactSchema = z.object({
  instance: capabilityInstanceSchema,
  side_effect: sideEffectSchema,
});
export type RouteInstanceFact = z.infer<typeof routeInstanceFactSchema>;

/**
 * 评估 id 种子：正整数。route id = route:<mission_id>:<seed>:<position>，
 * 同一 (mission, seed) 重复评估产生相同 id（重评估可对账）。
 */
export const routeIdSeedSchema = z.number().int().min(1);

/** 纯评估器的完整输入（domain/evaluate-route.ts）。 */
export interface EvaluateRouteCandidatesInput {
  readonly mission: Mission;
  readonly capabilityInstances: readonly RouteInstanceFact[];
  /**
   * RFC3339 UTC 评估时间锚点（必须经 TimePort 获得）。
   * W1 Route 契约没有时间戳字段；先守住输入纪律，additive 字段到来即可用。
   */
  readonly now: string;
  readonly idSeed: number;
}

/** 候选对比汇总：五个 route_class 全部可区分（W1 评估器不产 opportunity_constrained）。 */
export interface RouteCandidateSummary {
  readonly total: number;
  readonly existing: number;
  readonly conditional: number;
  readonly opportunity_constrained: number;
  readonly blocked: number;
  readonly unknown: number;
}

/** 评估产物：候选路由（全部 candidate）+ 对比汇总。 */
export interface RouteCandidateEvaluation {
  readonly routes: readonly Route[];
  readonly summary: RouteCandidateSummary;
}
