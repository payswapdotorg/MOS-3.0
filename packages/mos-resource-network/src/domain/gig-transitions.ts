import {
  assertGigHumanAssignmentJustified,
  gigSchema,
  nodeRefSchema,
  parseOrFail,
  routeComparisonSchema,
} from "@mos/contracts";
import type { Gig, GigStatus, RouteComparison } from "@mos/contracts";
import { gigIntakeSchema } from "../contract/gig.js";
import {
  GIG_STATUS_ASSIGNED,
  GIG_STATUS_DRAFT,
  GIG_STATUS_PUBLISHED,
  GigAssignmentBlockedError,
  GigPublishBlockedError,
  GigTransitionError,
  GigValidationError,
  RouteComparisonValidationError,
} from "../contract/gig.js";
import type {
  GigAssignment,
  GigCreationDeps,
  GigIntake,
  GigTransitionDeps,
} from "../contract/gig.js";

/** 合法转移表（具名状态机；unknown 无出边 —— fail-closed，绝不猜测 unknown 记录的含义）。 */
export const LEGAL_GIG_TRANSITIONS: Readonly<Record<GigStatus, readonly GigStatus[]>> = {
  draft: [GIG_STATUS_PUBLISHED, "cancelled"],
  published: [GIG_STATUS_ASSIGNED, "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
  cancelled: [],
  unknown: [],
};

/** 判定 (current, target) 是否合法边。 */
export function isLegalGigTransition(current: GigStatus, target: GigStatus): boolean {
  return (LEGAL_GIG_TRANSITIONS[current] as readonly GigStatus[]).includes(target);
}

/** 创建输入 → Gig（纯函数；创建恒为 draft，零比较、零指派）。 */
export function gigFromInput(input: GigIntake, deps: GigCreationDeps): Gig {
  const normalized = parseOrFail("GigIntake", gigIntakeSchema, input) as GigIntake;

  const gig: Gig = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    mission_id: normalized.mission_id,
    objective: normalized.objective,
    source_refs: [...normalized.source_refs],
    script_brief: normalized.script_brief,
    capture_or_execution_instructions: normalized.capture_or_execution_instructions,
    expected_output: normalized.expected_output,
    consent_rights: [...normalized.consent_rights],
    evaluator: { ...normalized.evaluator },
    deadline: normalized.deadline,
    budget_reward: normalized.budget_reward,
    expected_value_of_waiting: normalized.expected_value_of_waiting,
    alternative_route_ids: [...normalized.alternative_route_ids],
    route_comparison: null,
    assigned_node_ref: null,
    status: GIG_STATUS_DRAFT,
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail("Gig", gigSchema, gig) as Gig;
}

/**
 * §8 包完整性缺口（纯）：发布前必须补齐的可空披露。
 * deadline / budget_reward / expected_value_of_waiting 为 null 或
 * alternative_route_ids 为空 = 缺失；其余 §8 字段由 schema 强制非空。
 */
export function missingGigPackageDisclosures(gig: Gig): readonly string[] {
  const missing: string[] = [];
  if (gig.deadline === null) missing.push("deadline");
  if (gig.budget_reward === null) missing.push("budget_reward");
  if (gig.expected_value_of_waiting === null) missing.push("expected_value_of_waiting");
  if (gig.alternative_route_ids.length === 0) missing.push("alternative_route_ids");
  return missing;
}

/**
 * §23 人工指派缺口（纯）：指派给 human 节点前必须补齐的项。
 * 覆盖：§8 包披露、路线比较存在、候选类别覆盖（agent/engine、no-op/reuse、human）、
 * 无 adequate 非人工路线、比较证据引用。
 */
export function missingGigAssignmentJustification(gig: Gig): readonly string[] {
  if (gig.assigned_node_ref === null || gig.assigned_node_ref.kind !== "human") return [];
  const missing: string[] = [...missingGigPackageDisclosures(gig)];
  if (gig.route_comparison === null) {
    missing.push("route_comparison");
    return missing;
  }
  const compared = gig.route_comparison.compared_options;
  if (!compared.some((option) => option.kind === "agent_offer" || option.kind === "engine")) {
    missing.push("agent/engine compared option");
  }
  if (!compared.some((option) => option.kind === "no_op_reuse")) {
    missing.push("no-op/reuse compared option");
  }
  if (!compared.some((option) => option.kind === "human_offer")) {
    missing.push("human_offer compared option");
  }
  const adequate = compared.filter(
    (option) => option.kind !== "human_offer" && option.adequacy === "adequate",
  );
  if (adequate.length > 0) {
    missing.push(`adequate non-human route remains (${adequate.map((o) => o.ref).join(", ")})`);
  }
  if (gig.route_comparison.evidence_refs.length === 0) {
    missing.push("route_comparison evidence refs");
  }
  return missing;
}

/** draft → published：§8 包完整性门禁（具名缺失 → GigPublishBlockedError）。 */
export function publishGig(gig: Gig, deps: GigTransitionDeps): Gig {
  if (gig.status !== GIG_STATUS_DRAFT) {
    throw new GigTransitionError(
      gig.status,
      GIG_STATUS_PUBLISHED,
      "只有 draft 可以发布（§8 包完整性门禁）",
    );
  }
  const missing = missingGigPackageDisclosures(gig);
  if (missing.length > 0) {
    throw new GigPublishBlockedError(missing);
  }
  const next: Gig = { ...gig, status: GIG_STATUS_PUBLISHED, updated_at: deps.now };
  return parseOrFail("Gig", gigSchema, next) as Gig;
}

/** 指派输入物化：宽松输入 → 严格 NodeRef + RouteComparison（fail-closed 类型化错误）。 */
export function materializeAssignment(input: {
  assigned_node_ref: { kind: string; id: string };
  route_comparison?: unknown;
}): GigAssignment {
  const nodeRef = parseOrFail(
    "NodeRef",
    nodeRefSchema,
    input.assigned_node_ref,
  ) as GigAssignment["assigned_node_ref"];
  let comparison: RouteComparison | null = null;
  if (input.route_comparison !== null && input.route_comparison !== undefined) {
    try {
      comparison = parseOrFail(
        "RouteComparison",
        routeComparisonSchema,
        input.route_comparison,
      ) as RouteComparison;
    } catch (error) {
      throw new RouteComparisonValidationError(
        error instanceof Error ? [error.message] : ["route_comparison 校验失败"],
      );
    }
  }
  return {
    assigned_node_ref: nodeRef,
    route_comparison: comparison,
  };
}

/** published → assigned：非人工指派不需要比较；人工指派过 §23 门禁（fail-closed）。 */
export function assignGig(gig: Gig, assignment: GigAssignment, deps: GigTransitionDeps): Gig {
  if (gig.status !== GIG_STATUS_PUBLISHED) {
    throw new GigTransitionError(gig.status, GIG_STATUS_ASSIGNED, "只有 published 可以指派");
  }
  const next: Gig = {
    ...gig,
    assigned_node_ref: assignment.assigned_node_ref,
    route_comparison: assignment.route_comparison,
    status: GIG_STATUS_ASSIGNED,
    updated_at: deps.now,
  };
  if (assignment.assigned_node_ref.kind === "human") {
    const missing = missingGigAssignmentJustification(next);
    if (missing.length > 0) {
      throw new GigAssignmentBlockedError(gig.id, missing);
    }
  }
  // 不变量 §23 终守卫（defense in depth：store 落盘前还会对每条记录再跑一次）。
  assertGigHumanAssignmentJustified(next);
  return parseOrFail("Gig", gigSchema, next) as Gig;
}

/** 通用合法转移（in_progress / delivered / accepted / rejected / cancelled）。 */
export function applyGigTransition(gig: Gig, target: GigStatus, deps: GigTransitionDeps): Gig {
  if (!isLegalGigTransition(gig.status, target)) {
    throw new GigTransitionError(gig.status, target);
  }
  if (target === GIG_STATUS_PUBLISHED) {
    throw new GigValidationError(["publishGig 必须经发布门禁（§8 包完整性）"]);
  }
  if (target === GIG_STATUS_ASSIGNED) {
    throw new GigValidationError(["assignGig 必须经指派门禁（§23 人工指派需要路线比较）"]);
  }
  const next: Gig = { ...gig, status: target, updated_at: deps.now };
  assertGigHumanAssignmentJustified(next);
  return parseOrFail("Gig", gigSchema, next) as Gig;
}
