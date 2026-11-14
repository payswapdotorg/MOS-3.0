/**
 * Muse Code 工具审批桥策略（ACR-0002）。
 *
 * Muse Code 是一个完整的 agent：它请求工具授权时通过 MSP approval 回合交给
 * MOS 决定。MOS 不运行第二个工具环，也不解析 Muse 的内部权限存储——审批
 * 决策是唯一控制点，策略必须保守：
 *
 * - 默认 `deny`：一切工具授权被拒绝（选择服务端提供的拒绝/中止选项），
 *   Muse 会得到拒绝结果并继续回合（可见、受限、可预期）。
 * - 显式 `allow-once`（ZCODE_MUSE_TOOL_APPROVAL=allow-once）：只放行
 *   decision=approved 且 scope=once 的单次授权选项；绝不选择 session /
 *   localPersistent 级别的授权，绝不自动批准 protectedWrite 或未识别的
 *   subject kind（SDK 指南：unknown kind 永不自动放行）。
 */

import type { ApprovalDecisionInput } from "@muse-code/sdk";
import type { MuseApprovalRequestParams } from "./muse-event-mapper.js";

export type MuseToolApprovalPolicyName = "deny" | "allow-once";

export const DEFAULT_MUSE_TOOL_APPROVAL_POLICY: MuseToolApprovalPolicyName = "deny";
export const MUSE_TOOL_APPROVAL_ENV_VAR = "ZCODE_MUSE_TOOL_APPROVAL";

/**
 * allow-once 也只放行这些已知 subject kind（msp 指南：未知 kind 一律不自动放行）。
 * computerUseTakeover 有意不在其中：MOS 有自己的 CUA 权限 broker。
 */
const AUTO_APPROVABLE_SUBJECT_KINDS = new Set(["shell", "fileAccess", "network", "process"]);

/** 审批可见性钩子：决策产生时向事件流投影一行证据。 */
export type MuseApprovalObserver = (decision: {
  readonly approvalId: string;
  readonly toolName: string;
  readonly subjectKind: string;
  readonly decision: string;
  readonly scope: string;
  readonly bounded: boolean;
}) => void;

export function resolveMuseToolApprovalPolicy(
  envValue: string | undefined,
): MuseToolApprovalPolicyName {
  const normalized = envValue?.trim().toLowerCase();
  return normalized === "allow-once" || normalized === "allow_once" || normalized === "allowonce"
    ? "allow-once"
    : DEFAULT_MUSE_TOOL_APPROVAL_POLICY;
}

interface MuseApprovalChoice {
  readonly choiceId: string;
  readonly decision: string;
  readonly scope?: string;
}

/** 就地决策（纯函数，便于契约测试覆盖全部边界）。 */
export function decideMuseApproval(
  request: MuseApprovalRequestParams,
  policy: MuseToolApprovalPolicyName,
): ApprovalDecisionInput {
  const choices = (request.availableChoices ?? []) as readonly MuseApprovalChoice[];
  const denyChoice = pickDenyChoice(choices);
  if (policy === "deny") {
    return denyChoice;
  }
  if (request.protectedWrite === true) {
    // 受保护写入即使 allow-once 也拒绝：留给后续交互式审批桥（ACR-0002 后续项）。
    return denyChoice;
  }
  const subjectKind = request.subject?.kind;
  if (typeof subjectKind !== "string" || !AUTO_APPROVABLE_SUBJECT_KINDS.has(subjectKind)) {
    // 未知/不适用自动放行的 subject kind 一律拒绝（msp 指南：never auto-approve
    // a kind you do not recognize；computerUseTakeover 有意不在白名单）。
    return denyChoice;
  }
  const allowOnce = choices.find(
    (choice) => choice.decision === "approved" && choice.scope === "once",
  );
  if (allowOnce !== undefined) {
    return { choiceId: allowOnce.choiceId };
  }
  // 没有一次性授权选项时拒绝，不升级为会话级/持久授权。
  return denyChoice;
}

function pickDenyChoice(choices: readonly MuseApprovalChoice[]): ApprovalDecisionInput {
  const denied =
    choices.find((choice) => choice.decision === "denied") ??
    choices.find((choice) => choice.decision === "deniedPolicyAmendment") ??
    choices.find((choice) => choice.decision === "abort") ??
    choices.find((choice) => !choice.decision.startsWith("approved"));
  if (denied !== undefined) {
    return { choiceId: denied.choiceId };
  }
  // 服务端既未提供拒绝选项也未提供任何非批准选项：返回不存在的 choiceId，
  // SDK 的 unofferedChoice 守卫会拒绝发送并报告 failure，审批保持挂起并落到
  // 宿主自己的 default-deny 兜底——绝不退化为选择批准选项。
  return { choiceId: "" };
}
