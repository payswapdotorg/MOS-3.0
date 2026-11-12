import type { ZCodeSessionFacts, ZCodeUserIdentity } from "@mos/adapters";
import type { TenantContext } from "@mos/contracts";

/**
 * ZCode 身份/工作区 → MOS TenantContext 的纯映射（fail-closed）。
 * 约定（identity 权威归 session-port 事实）：
 * - tenant_id ← workspaceKey（ZCode 的工作区隔离键：workspaceIdentity || workspacePath）。
 * - workspace_id ← projectId（proj_*）；缺省回退 workspaceKey。
 * - actor_id ← 登录用户 id；缺失即解析失败（MOS 功能 fail-closed 到不可用）。
 * - brand_id 恒为 null（W1 无品牌概念，绝不编造）。
 * 任何必需事实缺失都返回 unavailable，绝不出推断值。
 */
export function resolveTenantContext(
  session: ZCodeSessionFacts | null,
  user: ZCodeUserIdentity | null,
): TenantContext | null {
  if (!session) return null;
  if (!session.workspace) return null;
  if (!user || !user.userId || user.userId.length === 0) return null;

  const workspaceKey = session.workspace.workspaceKey;
  if (workspaceKey.length === 0) return null;

  return {
    tenant_id: workspaceKey,
    workspace_id: session.workspace.projectId ?? workspaceKey,
    actor_id: user.userId,
    brand_id: null,
    source_zcode_session_id: session.sessionId,
    source_zcode_task_id: session.taskId,
  };
}

export function tenantUnavailableReason(
  session: ZCodeSessionFacts | null,
  user: ZCodeUserIdentity | null,
):
  | "session_facts_missing"
  | "workspace_facts_missing"
  | "user_identity_missing"
  | null {
  if (!session) return "session_facts_missing";
  if (!session.workspace) return "workspace_facts_missing";
  if (!user || !user.userId || user.userId.length === 0) return "user_identity_missing";
  return null;
}
