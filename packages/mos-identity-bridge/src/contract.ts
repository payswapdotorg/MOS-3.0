/**
 * 公共契约：身份桥的解析结果（fail-closed，不用异常表达预期的不可用）。
 */
import type { TenantContext } from "@mos/contracts";

export type TenantResolution =
  | { status: "resolved"; tenantContext: TenantContext }
  | { status: "unavailable"; reason: TenantUnavailableReason };

export type TenantUnavailableReason =
  | "session_facts_missing"
  | "workspace_facts_missing"
  | "user_identity_missing"
  | "tenant_context_invalid";

export type { TenantContext } from "@mos/contracts";
