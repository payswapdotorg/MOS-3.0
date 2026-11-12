import type {
  Capability,
  CapabilityInstance,
  ProviderConnection,
  ProviderImplementation,
} from "@mos/contracts";

/**
 * 账户能力实例解析的公共契约（fail-closed）。
 * 期望内的"不可用"用状态字段表达（instance.status/support_status/missing_preconditions），
 * 不用异常；注册/接线错误（能力未注册、tenant 不匹配）用类型化错误。
 */

/** 纯解析器的完整输入（domain/resolve-instance.ts）。 */
export interface ResolveInstanceInput {
  readonly tenantId: string;
  readonly connection: ProviderConnection;
  readonly capability: Capability;
  readonly implementation: ProviderImplementation;
  /** 工具映射核实事实（来自描述符 toolMapping.verified；未核实 → 永不 available）。 */
  readonly toolMappingVerified: boolean;
  /** RFC3339 UTC，必须经 TimePort 获得。 */
  readonly now: string;
}

/** 服务入口（application/resolver-service.ts）：按 id 从 catalog 取事实后调用纯解析器。 */
export interface ResolveForConnectionInput {
  readonly tenantId: string;
  readonly connection: ProviderConnection;
  readonly capabilityId: string;
  readonly implementationId: string;
}

/** 能力未注册（组合/接线错误，fail-closed 抛出）。 */
export class CapabilityNotFoundError extends Error {
  constructor(public readonly capabilityId: string) {
    super(`capability not registered: ${capabilityId}`);
    this.name = "CapabilityNotFoundError";
  }
}

/** 实现未注册（组合/接线错误，fail-closed 抛出）。 */
export class ImplementationNotFoundError extends Error {
  constructor(public readonly implementationId: string) {
    super(`implementation not registered: ${implementationId}`);
    this.name = "ImplementationNotFoundError";
  }
}

/** 连接不属于该 tenant（跨租户访问是 bug，fail-closed 抛出）。 */
export class ConnectionTenantMismatchError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly connectionTenantId: string,
  ) {
    super(`connection belongs to tenant ${connectionTenantId}, requested by ${tenantId}`);
    this.name = "ConnectionTenantMismatchError";
  }
}

export type { Capability, CapabilityInstance, ProviderConnection, ProviderImplementation };
