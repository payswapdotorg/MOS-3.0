import type { Engine } from "@mos/contracts";

/**
 * 能力 → Engine 匹配（纯函数，零 I/O、零 Date/random）。
 *
 * 决策锁 #9：匹配只基于注册表记录（Engine.status / capability_ids），
 * 绝不导入/调用任何具体 engine——被选中的 engine 由组合根经沙箱适配器调用。
 *
 * fail-closed 语义：
 * - matched 只包含 capability_ids 覆盖该能力且 status ∈ {registered, benchmarked} 的 engine；
 * - 覆盖该能力但不可匹配的 engine 绝不静默隐藏：deprecated / unknown 状态的 engine
 *   逐条落在 excluded（携带 reason），也绝不静默混入 matched；
 * - 未知能力不是错误：matched/excluded 均为空，noEngineRegistered=true
 *   （调用方可区分“无 engine 注册该能力”与“有 engine 但全部被排除”）。
 */

/** 排除原因词表（显式具名，绝不静默）。 */
export const ENGINE_EXCLUSION_REASONS = ["deprecated", "unknown_status"] as const;
export type EngineExclusionReason = (typeof ENGINE_EXCLUSION_REASONS)[number];

/** 覆盖该能力但不可匹配的 engine（绝不静默隐藏，也绝不静默匹配）。 */
export interface ExcludedEngineMatch {
  readonly engine: Engine;
  readonly reason: EngineExclusionReason;
}

/** matchEnginesForCapability 的结果（调用方可见的完整判定，无静默丢弃）。 */
export interface CapabilityEngineMatchResult {
  /** 参与匹配的能力 id（逐字回显）。 */
  readonly capabilityId: string;
  /** 覆盖该能力且 status ∈ {registered, benchmarked} 的 engine（按输入顺序）。 */
  readonly matched: readonly Engine[];
  /** 覆盖该能力但被排除的 engine（deprecated / unknown 状态，携带具名原因）。 */
  readonly excluded: readonly ExcludedEngineMatch[];
  /** 无任何 engine 注册该能力（matched 与 excluded 均为空）——不是错误，显式区分。 */
  readonly noEngineRegistered: boolean;
}

/** 参与匹配（capability_ids 覆盖该能力）的唯一判断。 */
function coversCapability(engine: Engine, capabilityId: string): boolean {
  return engine.capability_ids.includes(capabilityId);
}

/** 可匹配（status ∈ {registered, benchmarked}）的唯一判断。 */
function isMatchableStatus(engine: Engine): boolean {
  return engine.status === "registered" || engine.status === "benchmarked";
}

/** 排除原因：deprecated 显式具名；unknown 状态同样绝不静默（fail-closed）。 */
function exclusionReasonFor(engine: Engine): EngineExclusionReason | undefined {
  if (engine.status === "deprecated") return "deprecated";
  if (engine.status === "unknown") return "unknown_status";
  return undefined;
}

/**
 * 纯匹配器：输入 engine 集合与能力 id，输出 matched / excluded / noEngineRegistered。
 * 永不变异输入；matched/excluded 保持输入顺序（确定性）。
 */
export function matchEnginesForCapability(input: {
  readonly engines: readonly Engine[];
  readonly capabilityId: string;
}): CapabilityEngineMatchResult {
  const matched: Engine[] = [];
  const excluded: ExcludedEngineMatch[] = [];

  for (const engine of input.engines) {
    if (!coversCapability(engine, input.capabilityId)) continue;
    if (isMatchableStatus(engine)) {
      matched.push(engine);
      continue;
    }
    const reason = exclusionReasonFor(engine);
    if (reason !== undefined) {
      excluded.push({ engine, reason });
    }
  }

  return {
    capabilityId: input.capabilityId,
    matched,
    excluded,
    noEngineRegistered: matched.length === 0 && excluded.length === 0,
  };
}
