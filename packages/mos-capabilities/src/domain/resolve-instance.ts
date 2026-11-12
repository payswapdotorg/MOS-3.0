import { missingScopes } from "@mos/integrations";
import {
  assertCapabilityInstanceAvailability,
  capabilityInstanceSchema,
  InvariantViolation,
  parseOrFail,
  type CapabilityInstance,
  type ImplementationStatus,
} from "@mos/contracts";
import type { ResolveInstanceInput } from "../contract/resolver.js";

/**
 * 纯函数：账户能力实例解析（fail-closed 判定的唯一实现）。
 *
 * 可用性铁律（AGENTS.md §4 / core-contracts §invariants）——status 绝不为
 * "available"，除非同时满足：
 *   connection.status === "connected"
 *   AND capability/implementation 的 required_scopes 全部被授予（missingScopes 精确集合差）
 *   AND toolMappingVerified === true（工具映射经 live server 枚举核实）
 *   AND implementation.status === "available"
 *   AND implementation.evidence_refs 非空（available 实例必须有证据支撑）
 *
 * 状态语义（unsupported 与 unknown 不得互相归并）：
 * - support_status 表达"能力本身的知识状态"：unsupported（确认不支持）/
 *   supported（能力存在，账户差条件）/ unknown（工具映射未核实或能力状态未知）。
 * - status 表达"该账户此刻的实例状态"（implementationStatus 枚举）。
 * - missing_preconditions 用可机检前缀逐项列出缺口：
 *   connection:<status> / tool_mapping_unverified / scope:<scope> /
 *   account_type:<current|unknown> / implementation:<status> /
 *   capability:status_unknown / evidence:implementation_evidence_missing。
 *   确定性顺序：connection → tool_mapping → scope → account_type → implementation → capability → evidence。
 */
export function resolveCapabilityInstance(input: ResolveInstanceInput): CapabilityInstance {
  const { tenantId, connection, capability, implementation, toolMappingVerified, now } = input;

  if (connection.tenant_id !== tenantId) {
    throw new InvariantViolation(
      "capability-instance-tenant-scope",
      `连接 tenant (${connection.tenant_id}) 与请求 tenant (${tenantId}) 不一致`,
    );
  }

  const preconditions: string[] = [];

  // 1. 实时连接状态（expired/revoked/error/unknown 都是缺口，不猜）。
  const connectionOk = connection.status === "connected";
  if (!connectionOk) preconditions.push(`connection:${connection.status}`);

  // 2. 工具映射核实事实（描述符 UNVERIFIED → 能力知识降为 unknown）。
  if (!toolMappingVerified) preconditions.push("tool_mapping_unverified");

  // 3. scope 覆盖：capability 与 implementation 要求的并集，逐项精确集合差。
  const requiredScopes = [...new Set([...capability.required_scopes, ...implementation.required_scopes])];
  const missing = missingScopes(requiredScopes, connection.granted_scopes);
  const scopesCovered = missing.length === 0;
  for (const scope of missing) preconditions.push(`scope:${scope}`);

  // 4. 账户类型（strategy §2 第 5 层：resolver 必须检查账户类型；无要求时不设限）。
  const accountTypeOk =
    capability.required_account_types.length === 0 ||
    (connection.account_type !== null && capability.required_account_types.includes(connection.account_type));
  if (!accountTypeOk) preconditions.push(`account_type:${connection.account_type ?? "unknown"}`);

  // 5. 实现状态（unavailable/unknown 是缺口；degraded 由下面的状态判定单独处理）。
  if (implementation.status === "unavailable" || implementation.status === "unknown") {
    preconditions.push(`implementation:${implementation.status}`);
  }

  // 6. 能力知识状态未知（capability.support_status === "unknown"）。
  if (capability.support_status === "unknown") preconditions.push("capability:status_unknown");

  // support_status：unsupported/unknown 是能力级知识，不可被账户条件"修复"。
  let supportStatus = capability.support_status;
  if (supportStatus === "supported" && !toolMappingVerified) supportStatus = "unknown";

  let status: ImplementationStatus;
  const blockingPreconditions = preconditions.length > 0;
  if (capability.support_status === "unsupported") {
    // 确认不支持：terminal 状态，缺口清单只是事实披露，不会变成可用。
    status = "unavailable";
  } else if (blockingPreconditions) {
    status = "unavailable";
  } else if (implementation.status === "degraded") {
    // 连接/scope/映射都满足，实现降级 → 实例 degraded（部分可用，如实披露）。
    status = "degraded";
  } else if (implementation.evidence_refs.length === 0) {
    // available 必须证据支撑（evidence-backed）：无证据 → fail-closed。
    preconditions.push("evidence:implementation_evidence_missing");
    status = "unavailable";
  } else {
    status = "available";
  }

  const instance = parseOrFail("CapabilityInstance", capabilityInstanceSchema, {
    id: instanceId(tenantId, capability.id, connection.id),
    tenant_id: tenantId,
    connection_id: connection.id,
    capability_id: capability.id,
    implementation_id: implementation.id,
    support_status: supportStatus,
    status,
    available_quota: null,
    constraints: [],
    missing_preconditions: preconditions,
    checked_at: now,
    evidence_refs: implementation.evidence_refs,
  }) as CapabilityInstance;

  // 不变量守卫：available 必须由实时连接检查 + scope 检查支撑（§invariants 1/2）。
  assertCapabilityInstanceAvailability(instance, {
    liveConnectionChecked: connectionOk,
    requiredScopesCovered: scopesCovered,
  });
  return instance;
}

/** 确定性实例 id：同一 tenant/能力/连接 → 同一 id（重解析可对账，无需持久化生成）。 */
function instanceId(tenantId: string, capabilityId: string, connectionId: string): string {
  return `ci:${tenantId}:${capabilityId}:${connectionId}`;
}
