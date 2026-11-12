import {
  assertNoInferredMissionFields,
  missionIntakeSchema,
  missionSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Mission, MissionIntake } from "@mos/contracts";
import { MISSION_STATUS_ACTIVE } from "../contract/mission-vocabulary.js";
import type { MissionFromIntakeDeps } from "../contract.js";

/**
 * 逐字 intake → Mission（纯函数，零推断；core-contracts §Mission）。
 *
 * 规则（invariant §9：不得从营销简报推断缺失值）：
 * - objective ← objective_verbatim：逐字保存（含标点、大小写与内部空白），
 *   只做"非空白"守卫（assertNoInferredMissionFields），绝不改写、补全或同义转换；
 * - target_audience / geography / budget / deadline 未提供时保持 null，
 *   空字符串视为违规（缺失值必须是 null 而不是空串）；
 * - desired_outcomes / success_metrics 未提供时保持空数组，与调用方提供的完全一致；
 * - constraints 恒为空对象（intake 契约不含 constraints，绝不发明）；
 * - status = active（W1 词表）；created_at/updated_at = deps.now；id = deps.id；
 * - 产物必须同时通过 missionSchema 与 assertNoInferredMissionFields（双向守卫）。
 */
export function missionFromIntake(
  intake: MissionIntake,
  deps: MissionFromIntakeDeps,
): Mission {
  const normalized = parseOrFail(
    "MissionIntake",
    missionIntakeSchema,
    intake,
  ) as MissionIntake;

  const mission: Mission = {
    id: deps.id,
    version: 1,
    tenant_id: normalized.tenant_id,
    workspace_id: normalized.workspace_id,
    objective: normalized.objective_verbatim,
    target_audience: normalized.target_audience,
    geography: normalized.geography,
    desired_outcomes: [...normalized.desired_outcomes],
    constraints: {},
    budget: normalized.budget,
    deadline: normalized.deadline,
    success_metrics: [...normalized.success_metrics],
    source_zcode_session_id: normalized.source_zcode_session_id,
    source_zcode_task_id: normalized.source_zcode_task_id,
    status: MISSION_STATUS_ACTIVE,
    created_at: deps.now,
    updated_at: deps.now,
  };

  const validated = parseOrFail("Mission", missionSchema, mission) as Mission;
  assertNoInferredMissionFields(validated);
  return validated;
}
