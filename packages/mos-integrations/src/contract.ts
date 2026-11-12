/**
 * mos-integrations 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型从这里窄口导出；schema/实现集合经 index.ts 提供。
 * 本文件不声明方法（≤300 行）。
 */
export type {
  ProviderDescriptor,
  ProviderEndpoint,
  ProviderCandidateTool,
} from "./contract/hubspot-descriptor.js";
export type {
  ContactsReadQuery,
  ContactsReadOutcome,
  ContactsReadSuccess,
  ContactsReadFailure,
  ProviderReadShape,
} from "./contract/read-adapter.js";
export { ConnectionNotFoundError } from "./contract/read-adapter.js";
export type {
  ConnectorTemplateManifest,
  ConnectorMcpServerEntry,
  HubSpotConnectorTemplate,
} from "./connector/hubspot-connector-declaration.js";
export type { ConnectionUpsertInput } from "./application/connection-store.js";
export { InvariantViolation } from "@mos/contracts";
export type { TimePort } from "@mos/adapters";
