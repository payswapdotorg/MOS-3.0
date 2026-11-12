import {
  capabilitySchema,
  parseOrFail,
  providerImplementationSchema,
  type Capability,
  type ProviderImplementation,
} from "@mos/contracts";
import { z } from "zod";
import {
  capabilityDescriptorSchema,
  type CapabilityDescriptor,
  type CapabilityDescriptorInput,
} from "../contract/descriptor.js";

/**
 * 能力目录（fail-closed 注册边界）：
 * - descriptor 注册时必须通过 capabilityDescriptorSchema 校验（解析失败抛错，绝不静默入库）；
 * - 同时投影出 core-contracts 的 Capability（capabilitySchema 再校验一次）；
 * - implementation 注册时必须通过 providerImplementationSchema 校验；
 * - 索引键：descriptor/capability 按 capabilityId，implementation 按 id。
 *   同键重复注册 = 替换（最新描述符胜出），W1 无多版本并存需求。
 */
export class CapabilityCatalog {
  private readonly descriptors = new Map<string, CapabilityDescriptor>();
  private readonly capabilities = new Map<string, Capability>();
  private readonly implementations = new Map<string, ProviderImplementation>();

  /** 注册/替换能力描述符，返回投影出的 Capability（契约校验后）。 */
  register(descriptor: CapabilityDescriptorInput): Capability {
    const parsed = parseOrFail(
      "CapabilityDescriptor",
      capabilityDescriptorSchema,
      descriptor,
    ) as CapabilityDescriptor;
    const capability = capabilityFromDescriptor(parsed);
    this.descriptors.set(parsed.capabilityId, parsed);
    this.capabilities.set(parsed.capabilityId, capability);
    return capability;
  }

  /** 注册/替换 provider 实现（fail-closed：契约校验失败抛 ContractValidationError）。 */
  registerImplementation(
    implementation: z.input<typeof providerImplementationSchema>,
  ): ProviderImplementation {
    const parsed = parseOrFail(
      "ProviderImplementation",
      providerImplementationSchema,
      implementation,
    ) as ProviderImplementation;
    this.implementations.set(parsed.id, parsed);
    return parsed;
  }

  getCapability(capabilityId: string): Capability | null {
    return this.capabilities.get(capabilityId) ?? null;
  }

  /** 描述符（工具映射核实事实等由此读取；catalog 的附加查询口）。 */
  getDescriptor(capabilityId: string): CapabilityDescriptor | null {
    return this.descriptors.get(capabilityId) ?? null;
  }

  getImplementation(implementationId: string): ProviderImplementation | null {
    return this.implementations.get(implementationId) ?? null;
  }

  implementationsForCapability(capabilityId: string): readonly ProviderImplementation[] {
    return [...this.implementations.values()].filter(
      (implementation) => implementation.capability_id === capabilityId,
    );
  }
}

/** 描述符 → core-contracts Capability 投影（描述符字段是驼峰，契约字段是蛇形）。 */
function capabilityFromDescriptor(descriptor: CapabilityDescriptor): Capability {
  return parseOrFail("Capability", capabilitySchema, {
    id: descriptor.capabilityId,
    version: descriptor.version,
    domain: descriptor.domain,
    description: descriptor.description,
    input_schema: descriptor.inputSchema,
    output_schema: descriptor.outputSchema,
    side_effect: descriptor.sideEffect,
    support_status: descriptor.supportStatus,
    required_scopes: descriptor.requiredScopes,
    required_account_types: descriptor.requiredAccountTypes,
    risk_level: descriptor.riskLevel,
  }) as Capability;
}
