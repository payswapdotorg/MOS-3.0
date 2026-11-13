/**
 * mos-lab 词表、显式缺口标记与时间端口。
 * - 状态/类别词表：core-contracts §enums 的 additive 命名值在本模块的使用约定；
 * - 缺口标记：program discovery 的 missing_preconditions 公共语言（绝不静默吞掉缺口）；
 * - TimePort：结构化注入的时间端口（领域层零 Date/random 依赖）。
 */

/** 假设创建状态：Lab 写边界创建假设时恒为 proposed（决策锁 #18——状态词汇无结果语义）。 */
export const HYPOTHESIS_STATUS_PROPOSED = "proposed" as const;

/**
 * Lab 写边界允许的假设状态：proposed / superseded / withdrawn / unknown。
 * adopted_by_experiment 表达实验采纳（结果语义），写入权归 Experiment authority（W3）；
 * Lab 的任何写路径都不得产生或修改它（决策锁 #18，守卫见 domain/hypothesis.ts）。
 */
export const LAB_WRITABLE_HYPOTHESIS_STATUSES = [
  "proposed",
  "superseded",
  "withdrawn",
  "unknown",
] as const;
export type LabWritableHypothesisStatus = (typeof LAB_WRITABLE_HYPOTHESIS_STATUSES)[number];

/** offer 参与程序匹配的唯一状态：draft / withdrawn / expired / unknown 一律不被引用。 */
export const OFFER_STATUS_PUBLISHED = "published" as const;

/** 可建议的路由类别：只有 existing / conditional 进入 route_refs（RouteClass 的真子集）。 */
export const SUGGESTIBLE_ROUTE_CLASSES = ["existing", "conditional"] as const;
export type SuggestibleRouteClass = (typeof SUGGESTIBLE_ROUTE_CLASSES)[number];

/** 假设未引用任何路由时的显式标记（绝不静默产出无法解释的空程序）。 */
export const NO_PROPOSED_ROUTES = "no_proposed_routes" as const;

/** 能力无已发布 offer 的显式缺口标记（missing_preconditions 语言，绝不静默吞掉）。 */
export function noPublishedOfferForCapability(capabilityId: string): string {
  return `no published offer for capability ${capabilityId}`;
}

/** 路由类别不可建议时的显式缺口标记（blocked / unknown / opportunity_constrained 一律显式暴露）。 */
export function routeNotActionable(routeId: string, routeClass: string): string {
  return `route ${routeId} not actionable: route_class:${routeClass}`;
}

/**
 * 时间端口（结构化注入）：created_at / updated_at 一律经端口获得，领域层零 Date/random。
 * 与底物 TimePort（{ now(): string }）同形——本模块 requires 只有 mos-contracts
 * （见 module.ts），组合根可直接注入任一 TimePort 实现（结构化满足）。
 */
export interface TimePort {
  now(): string;
}
