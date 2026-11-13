import {
  assertDistributionPreviewApproval,
  distributionIntentSchema,
  parseOrFail,
} from "@mos/contracts";
import type {
  ApprovalState,
  DistributionIntent,
  DistributionStatus,
} from "@mos/contracts";
import {
  ApprovalRequiredError,
  DISTRIBUTION_APPROVAL_APPROVED,
  DISTRIBUTION_APPROVAL_PENDING,
  DISTRIBUTION_APPROVAL_REJECTED,
  DISTRIBUTION_STATUS_APPROVED,
  DISTRIBUTION_STATUS_EXECUTING,
  DISTRIBUTION_STATUS_FAILED,
  DISTRIBUTION_STATUS_INTENT,
  DISTRIBUTION_STATUS_PENDING_APPROVAL,
  DISTRIBUTION_STATUS_PREVIEWED,
  DISTRIBUTION_STATUS_REJECTED,
  DISTRIBUTION_STATUS_SUCCEEDED,
  distributionIntentInputSchema,
  IntentTransitionError,
  IntentValidationError,
  PreviewRequiredError,
  previewBindingSchema,
} from "../contract/intent.js";
import type {
  DistributionIntentInput,
  PreviewBinding,
} from "../contract/intent.js";
import type {
  IntentCreationDeps,
  IntentTransitionDeps,
} from "../contract.js";

/**
 * DistributionIntent 纯状态机（零 I/O、零 Date/random、零 provider 调用——决策锁 #8）。
 *
 * 合法边（其余一律 IntentTransitionError，具名 current/target）：
 * - intent→previewed：要求 preview_ref + preview_hash 已绑定（bindPreview 是正道；
 *   直接转移未绑预览 → PreviewRequiredError）；
 * - previewed→pending_approval；
 * - pending_approval→approved / rejected：该转移即审批决定，同步写 approval_state；
 * - approved→executing：要求 approval_state=approved 且预览已绑定
 *   （PreviewRequiredError / ApprovalRequiredError 具名），并调用
 *   assertDistributionPreviewApproval 终守卫（不变量 §22）；
 * - executing→succeeded / failed；
 * - succeeded / failed / rejected 为终态（无出边）。
 *
 * execution_records 只是 evidence 引用（append-only）；provider 真正的执行
 * 归 Integration adapters（组合根），本包零 provider I/O。
 */

/** 合法转移表（具名状态机；unknown 无出边 —— fail-closed，绝不猜测 unknown 记录的含义）。 */
export const LEGAL_INTENT_TRANSITIONS: Readonly<
  Record<DistributionStatus, readonly DistributionStatus[]>
> = {
  intent: [DISTRIBUTION_STATUS_PREVIEWED],
  previewed: [DISTRIBUTION_STATUS_PENDING_APPROVAL],
  pending_approval: [DISTRIBUTION_STATUS_APPROVED, DISTRIBUTION_STATUS_REJECTED],
  approved: [DISTRIBUTION_STATUS_EXECUTING],
  executing: [DISTRIBUTION_STATUS_SUCCEEDED, DISTRIBUTION_STATUS_FAILED],
  succeeded: [],
  failed: [],
  rejected: [],
  unknown: [],
};

/** 判定 (current, target) 是否合法边。 */
export function isLegalIntentTransition(
  current: DistributionStatus,
  target: DistributionStatus,
): boolean {
  return (LEGAL_INTENT_TRANSITIONS[current] as readonly DistributionStatus[]).includes(
    target,
  );
}

/**
 * 创建输入 → DistributionIntent（纯函数）。
 * 创建恒为 status=intent、preview 未绑定、approval_state=pending
 * （三种操作全部有副作用，绝不写 not_required —— 不变量 §4/§5）、execution_records=[]；
 * 其余字段逐字保存（artifact_version / idempotency_key 未提供保持 null）。
 */
export function intentFromInput(
  input: DistributionIntentInput,
  deps: IntentCreationDeps,
): DistributionIntent {
  const normalized = parseOrFail(
    "DistributionIntentInput",
    distributionIntentInputSchema,
    input,
  ) as DistributionIntentInput;

  const intent: DistributionIntent = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    operation: normalized.operation,
    connection_id: normalized.connection_id,
    capability_instance_id: normalized.capability_instance_id,
    artifact_ref: normalized.artifact_ref,
    artifact_version: normalized.artifact_version,
    target: { ...normalized.target },
    preview_ref: null,
    preview_hash: null,
    approval_state: DISTRIBUTION_APPROVAL_PENDING,
    idempotency_key: normalized.idempotency_key,
    status: DISTRIBUTION_STATUS_INTENT,
    execution_records: [],
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail(
    "DistributionIntent",
    distributionIntentSchema,
    intent,
  ) as DistributionIntent;
}

/**
 * 绑定 ExternalActionPreview（不变量 §22 的第一步）：只在 status=intent 时可绑定，
 * 绑定即推进到 previewed；预览绑定后不可重绑（要换预览就新建意图，绝不静默改写）。
 */
export function bindPreview(
  intent: DistributionIntent,
  binding: PreviewBinding,
  deps: IntentTransitionDeps,
): DistributionIntent {
  const normalized = parseOrFail(
    "PreviewBinding",
    previewBindingSchema,
    binding,
  ) as PreviewBinding;
  if (intent.status !== DISTRIBUTION_STATUS_INTENT) {
    throw new IntentTransitionError(
      intent.status,
      DISTRIBUTION_STATUS_PREVIEWED,
      "预览只能在 status=intent 时绑定（绑定后不可重绑）",
    );
  }
  const previewed: DistributionIntent = {
    ...intent,
    preview_ref: normalized.preview_ref,
    preview_hash: normalized.preview_hash,
    status: DISTRIBUTION_STATUS_PREVIEWED,
    updated_at: deps.now,
  };
  return parseOrFail(
    "DistributionIntent",
    distributionIntentSchema,
    previewed,
  ) as DistributionIntent;
}

/**
 * 审批决定如何随转移写入 approval_state：
 * pending_approval→approved/rejected 即审批决定本身；其余转移保持现值。
 */
function approvalStateForTransition(
  target: DistributionStatus,
  current: ApprovalState,
): ApprovalState {
  if (target === DISTRIBUTION_STATUS_APPROVED) return DISTRIBUTION_APPROVAL_APPROVED;
  if (target === DISTRIBUTION_STATUS_REJECTED) return DISTRIBUTION_APPROVAL_REJECTED;
  return current;
}

/**
 * 状态机转移（纯函数）：先按 LEGAL_INTENT_TRANSITIONS 判定边的合法性
 * （非法边 → IntentTransitionError，具名 current/target），再执行边级门禁：
 * - 目标 previewed：要求预览已绑定（否则 PreviewRequiredError）；
 * - 目标 executing：要求预览已绑定（PreviewRequiredError）且 approval_state=approved
 *   （ApprovalRequiredError），物化后调用 assertDistributionPreviewApproval 终守卫。
 */
export function applyIntentTransition(
  intent: DistributionIntent,
  target: DistributionStatus,
  deps: IntentTransitionDeps,
): DistributionIntent {
  if (!isLegalIntentTransition(intent.status, target)) {
    throw new IntentTransitionError(intent.status, target);
  }

  if (target === DISTRIBUTION_STATUS_PREVIEWED && (intent.preview_ref === null || intent.preview_hash === null)) {
    throw new PreviewRequiredError(intent.id, target);
  }

  if (target === DISTRIBUTION_STATUS_EXECUTING) {
    if (intent.preview_ref === null || intent.preview_hash === null) {
      throw new PreviewRequiredError(intent.id, target);
    }
    if (intent.approval_state !== DISTRIBUTION_APPROVAL_APPROVED) {
      throw new ApprovalRequiredError(intent.id, intent.approval_state);
    }
  }

  const next: DistributionIntent = {
    ...intent,
    status: target,
    approval_state: approvalStateForTransition(target, intent.approval_state),
    updated_at: deps.now,
  };

  if (target === DISTRIBUTION_STATUS_EXECUTING) {
    // 不变量 §22 终守卫（defense in depth：store 落盘前还会对每条记录再跑一次）。
    assertDistributionPreviewApproval(next);
  }

  return parseOrFail("DistributionIntent", distributionIntentSchema, next) as DistributionIntent;
}

/** 允许追加执行证据引用的状态：执行证据只属于已开始的执行（intent/previewed/
 * pending_approval/approved/rejected 阶段绝不存在 provider 执行证据）。 */
export const EXECUTION_EVIDENCE_STATUSES: readonly DistributionStatus[] = [
  DISTRIBUTION_STATUS_EXECUTING,
  DISTRIBUTION_STATUS_SUCCEEDED,
  DISTRIBUTION_STATUS_FAILED,
];

/**
 * 追加执行证据引用（append-only；evidence refs ONLY —— provider 执行本身
 * 归 Integration adapters，本函数只记录不透明 evidence 引用）。
 * 非执行状态（含 rejected / 未审批阶段）追加执行证据 → IntentTransitionError
 * （fail-closed：没有已批准预览的执行不可能是真实执行）。
 */
export function recordExecution(
  intent: DistributionIntent,
  evidenceRef: string,
  deps: IntentTransitionDeps,
): DistributionIntent {
  if (typeof evidenceRef !== "string" || evidenceRef.length === 0) {
    throw new IntentValidationError([
      "execution evidence ref 必须是非空字符串（不透明 evidence 引用）",
    ]);
  }
  if (!(EXECUTION_EVIDENCE_STATUSES as readonly DistributionStatus[]).includes(intent.status)) {
    throw new IntentTransitionError(
      intent.status,
      DISTRIBUTION_STATUS_EXECUTING,
      "执行证据引用只能在 executing/succeeded/failed 追加（append-only evidence refs）",
    );
  }
  const next: DistributionIntent = {
    ...intent,
    execution_records: [...intent.execution_records, evidenceRef],
    updated_at: deps.now,
  };
  // 不变量 §22 终守卫：执行证据绝不可能挂在未绑定已批准预览的记录上。
  assertDistributionPreviewApproval(next);
  return parseOrFail("DistributionIntent", distributionIntentSchema, next) as DistributionIntent;
}
