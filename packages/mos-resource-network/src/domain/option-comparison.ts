import {
  assertDiscoverySurfacesExclusions,
  executionOptionSchema,
  parseOrFail,
} from "@mos/contracts";
import type { ExecutionOption, ExecutionRecommendation } from "@mos/contracts";

/**
 * §8 路线比较（纯函数）：比较人工要约 vs 代理/引擎 vs no-op/reuse 候选。
 * 推荐顺序遵守决策锁 #17（no-op/reuse 是真实路线，优先于生成）与 §8
 * （存在 adequate 已批准路线时绝不默认指派真人）。
 * adequacy=unknown 绝不算 adequate（决策锁 #14）。
 */

export interface ExcludedExecutionOption {
  readonly option: ExecutionOption;
  readonly reason: string;
}

export interface ExecutionOptionComparison {
  readonly recommendation: ExecutionRecommendation;
  /** true 仅当 recommendation === "human"（无 adequate 非人工路线 + 至少一条 adequate 人工要约）。 */
  readonly humanAssignmentJustified: boolean;
  readonly adequate: readonly ExecutionOption[];
  readonly excluded: readonly ExcludedExecutionOption[];
}

function exclusionReason(option: ExecutionOption): string {
  if (option.adequacy === "unknown") {
    return "adequacy unknown — never treated as adequate";
  }
  const detail =
    option.inadequacy_reason !== null && option.inadequacy_reason.length > 0
      ? option.inadequacy_reason
      : "no reason supplied";
  return `${option.adequacy}: ${detail}`;
}

/** 比较 §8 候选集合 → 推荐结论（空输入 → no_adequate_route，绝不默认指派真人）。 */
export function compareExecutionOptions(
  options: readonly unknown[],
): ExecutionOptionComparison {
  const parsed = options.map(
    (option) => parseOrFail("ExecutionOption", executionOptionSchema, option) as ExecutionOption,
  );

  const adequate = parsed.filter((option) => option.adequacy === "adequate");
  const excluded: ExcludedExecutionOption[] = parsed
    .filter((option) => option.adequacy !== "adequate")
    .map((option) => ({ option, reason: exclusionReason(option) }));

  // 不变量 §26（defense in depth）：排除项必须带具名原因，绝不隐藏。
  assertDiscoverySurfacesExclusions(
    excluded.map((item) => ({ ref: item.option.ref, reason: item.reason })),
  );

  const hasAdequateReuse = adequate.some((option) => option.kind === "no_op_reuse");
  const hasAdequateMachine = adequate.some(
    (option) => option.kind === "agent_offer" || option.kind === "engine",
  );
  const hasAdequateHuman = adequate.some((option) => option.kind === "human_offer");

  let recommendation: ExecutionRecommendation = "no_adequate_route";
  if (hasAdequateReuse) {
    recommendation = "no_op_reuse";
  } else if (hasAdequateMachine) {
    recommendation = "agent_or_engine";
  } else if (hasAdequateHuman) {
    recommendation = "human";
  }

  return {
    recommendation,
    humanAssignmentJustified: recommendation === "human",
    adequate,
    excluded,
  };
}
