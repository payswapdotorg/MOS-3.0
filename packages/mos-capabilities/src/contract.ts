/**
 * mos-capabilities 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型从这里窄口导出；schema/实现集合经 index.ts 提供。
 * 本文件不声明方法（≤300 行）。
 */
export type {
  CapabilityDescriptor,
  CapabilityDescriptorInput,
  DescriptorToolMapping,
  DescriptorEvidenceSource,
} from "./contract/descriptor.js";
export type {
  ResolveInstanceInput,
  ResolveForConnectionInput,
  Capability,
  CapabilityInstance,
  ProviderConnection,
  ProviderImplementation,
} from "./contract/resolver.js";
export {
  CapabilityNotFoundError,
  ImplementationNotFoundError,
  ConnectionTenantMismatchError,
} from "./contract/resolver.js";
export { InvariantViolation } from "@mos/contracts";
export type { TimePort } from "@mos/integrations";
