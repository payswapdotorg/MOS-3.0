import { InvariantViolation, type CapabilityInstance, type ProviderConnection } from "@mos/contracts";
import type { TimePort } from "@mos/integrations";
import { resolveCapabilityInstance } from "../domain/resolve-instance.js";
import {
  CapabilityNotFoundError,
  ConnectionTenantMismatchError,
  ImplementationNotFoundError,
  type ResolveForConnectionInput,
} from "../contract/resolver.js";
import type { CapabilityCatalog } from "./catalog.js";

/**
 * 账户能力实例解析服务：catalog（事实）+ TimePort（checked_at）+ 纯解析器（判定）。
 *
 * fail-closed 顺序：
 * 1. 连接必须属于请求 tenant（跨租户 → 类型化错误，绝不静默换租户解析）；
 * 2. 能力/实现必须已注册（接线错误 → 类型化错误）；
 * 3. 实现必须真的实现该能力（配对不变量违规 → InvariantViolation）；
 * 4. 工具映射核实事实取自描述符 toolMapping.verified（未注册描述符 → false，绝不猜 true）；
 * 5. 判定交给纯解析器（available 永远有实时检查 + scope 检查 + 证据支撑）。
 */
export class CapabilityInstanceResolverService {
  private readonly catalog: CapabilityCatalog;
  private readonly time: TimePort;

  constructor(deps: { catalog: CapabilityCatalog; time: TimePort }) {
    this.catalog = deps.catalog;
    this.time = deps.time;
  }

  resolveForConnection(input: ResolveForConnectionInput): CapabilityInstance {
    const { tenantId, connection } = input;
    assertConnectionTenant(tenantId, connection);

    const capability = this.catalog.getCapability(input.capabilityId);
    if (capability === null) throw new CapabilityNotFoundError(input.capabilityId);

    const implementation = this.catalog.getImplementation(input.implementationId);
    if (implementation === null) throw new ImplementationNotFoundError(input.implementationId);

    if (implementation.capability_id !== capability.id) {
      throw new InvariantViolation(
        "capability-implementation-pairing",
        `implementation ${implementation.id} 属于 capability ${implementation.capability_id}，不是 ${capability.id}`,
      );
    }

    const descriptor = this.catalog.getDescriptor(input.capabilityId);
    const toolMappingVerified = descriptor?.toolMapping.verified ?? false;

    return resolveCapabilityInstance({
      tenantId,
      connection,
      capability,
      implementation,
      toolMappingVerified,
      now: this.time.now(),
    });
  }
}

function assertConnectionTenant(tenantId: string, connection: ProviderConnection): void {
  if (connection.tenant_id !== tenantId) {
    throw new ConnectionTenantMismatchError(tenantId, connection.tenant_id);
  }
}
