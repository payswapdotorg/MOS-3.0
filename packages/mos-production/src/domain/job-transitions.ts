import { assertJobNeverExecutes, parseOrFail, productionJobSchema } from "@mos/contracts";
import type { ProductionJob, ProductionJobStatus } from "@mos/contracts";
import { JobTransitionError } from "../contract/job.js";
import type { ProductionJobEvent } from "../contract/job.js";

/**
 * ProductionJob 状态转移（纯函数，零 I/O、零 Date/random）。
 *
 * 决策锁 #5（无第二执行器）：本包只记录持久业务状态——
 * - 没有任何方法启动/运行/执行任何东西；
 * - zcode_execution_ref 是组合根供给的不透明外部引用（指向 ZCode 侧执行）；
 * - linked→executing 只能经外部观测（executing 是纯观测事件，不带 MOS 侧数据）；
 * - 每次转移计算完成后无条件调用 assertJobNeverExecutes（共享契约守卫），
 *   越过 linked 的记录必须持有外部执行引用。
 *
 * 合法转移表（其余一律 JobTransitionError 具名拒绝）：
 * - pending + linked → linked（必须携带 zcode_execution_ref + started_at）；
 * - linked + executing → executing（仅外部观测）；
 * - executing + succeeded → succeeded（必须携带 completed_at）；
 * - executing + failed → failed（必须携带 failure 说明）；
 * - pending/linked + cancelled → cancelled。
 *
 * 已知契约张力（显式上报 TL，绝不静默择一）：
 * 共享守卫 assertJobNeverExecutes 把 cancelled 视为“越过 linked”——
 * 从 pending 直接取消的记录（无外部执行引用）会被该守卫拒绝（InvariantViolation）。
 * 转移表按 W3-B 工作包保持 pending→cancelled 合法；该路径在记录层被共享守卫
 * fail-closed 拦截，属 spec（转移表）与 code（守卫）冲突，需 TL 裁决。
 */

/** 事件数据完整性检查（fail-closed；格式校验另由 productionJobEventSchema 承担）。 */
function assertEventData(event: ProductionJobEvent): void {
  switch (event.kind) {
    case "linked":
      if (event.zcode_execution_ref.trim().length === 0) {
        throw new JobTransitionError(
          "<unknown>",
          event.kind,
          "linked 事件必须携带非空外部 zcode_execution_ref",
        );
      }
      if (event.started_at.trim().length === 0) {
        throw new JobTransitionError(
          "<unknown>",
          event.kind,
          "linked 事件必须携带 started_at",
        );
      }
      return;
    case "succeeded":
      if (event.completed_at.trim().length === 0) {
        throw new JobTransitionError(
          "<unknown>",
          event.kind,
          "succeeded 事件必须携带 completed_at",
        );
      }
      return;
    case "failed":
      if (event.failure.trim().length === 0) {
        throw new JobTransitionError("<unknown>", event.kind, "failed 事件必须携带 failure 说明");
      }
      return;
    case "executing":
    case "cancelled":
      return;
  }
}

/** 合法转移表（纯查表；非法组合具名拒绝）。 */
function transition(
  current: ProductionJobStatus,
  eventKind: ProductionJobEvent["kind"],
): ProductionJobStatus {
  if (current === "pending") {
    if (eventKind === "linked") return "linked";
    if (eventKind === "cancelled") return "cancelled";
  }
  if (current === "linked") {
    if (eventKind === "executing") return "executing";
    if (eventKind === "cancelled") return "cancelled";
  }
  if (current === "executing") {
    if (eventKind === "succeeded") return "succeeded";
    if (eventKind === "failed") return "failed";
  }
  throw new JobTransitionError(
    current,
    eventKind,
    "非法状态转移（合法表：pending→linked，linked→executing（仅外部观测），executing→succeeded|failed，pending|linked→cancelled）",
  );
}

/**
 * 纯转移函数：给定当前状态与事件，计算下一状态。
 * - 事件数据缺失（linked 无外部引用/started_at、succeeded 无 completed_at、
 *   failed 无 failure）→ JobTransitionError（具名）；
 * - 非法组合 → JobTransitionError（携带当前状态与事件名）。
 */
export function nextJobStatus(
  current: ProductionJobStatus,
  event: ProductionJobEvent,
): ProductionJobStatus {
  assertEventData(event);
  return transition(current, event.kind);
}

/**
 * 事件应用到 job 记录（纯函数）：
 * 1. nextJobStatus 计算下一状态（非法转移/缺失数据 → JobTransitionError）；
 * 2. 事件数据逐字并入记录（linked 写入外部引用与 started_at；succeeded 写入
 *    completed_at；failed 写入 failure）+ updated_at = 注入的 now；
 * 3. productionJobSchema 物化（fail-closed）；
 * 4. assertJobNeverExecutes 最终守卫（决策锁 #5——执行归 ZCode，
 *    MOS 只记录状态；越过 linked 的记录必须持有外部执行引用）。
 */
export function applyJobEvent(
  job: ProductionJob,
  event: ProductionJobEvent,
  now: string,
): ProductionJob {
  const next = nextJobStatus(job.status, event);

  const updated: ProductionJob = {
    ...job,
    status: next,
    zcode_execution_ref:
      event.kind === "linked" ? event.zcode_execution_ref : job.zcode_execution_ref,
    started_at: event.kind === "linked" ? event.started_at : job.started_at,
    completed_at: event.kind === "succeeded" ? event.completed_at : job.completed_at,
    failure: event.kind === "failed" ? event.failure : job.failure,
    updated_at: now,
  };

  const validated = parseOrFail("ProductionJob", productionJobSchema, updated) as ProductionJob;
  assertJobNeverExecutes(validated);
  return validated;
}
