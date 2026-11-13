/**
 * mos-studio 公共契约（architecture-policy.yaml 公开入口之一）。
 * 类型窄口 + 常量再导出；不声明接口/类方法（≤300 行）。
 * 组合根装配相关的 class 形状由 src/application/* 声明；真实栈接线在 src/runtime
 * （默认 typecheck 排除 —— fresh-clone 不依赖 CLI dist；见 CONTRACT.md 运行前提）。
 */
export {
  STUDIO_SERVER_NAME,
  STUDIO_PANEL_URI,
  STUDIO_PANEL_MIME,
  COMPOSIO_CREDENTIAL_REF,
  COMPOSIO_CONNECTION_ID,
  STUDIO_COMPOSIO_CAPABILITY_ID,
  STUDIO_COMPOSIO_DESCRIPTOR_ID,
  STUDIO_COMPOSIO_IMPLEMENTATION_ID,
  MOS_STUDIO_STATUS_TOOL,
  MOS_SET_OPERATOR_TOOL,
  MOS_LIST_MISSIONS_TOOL,
  MOS_RECORD_MISSION_INTAKE_TOOL,
  MOS_CONNECT_COMPOSIO_TOOL,
  MOS_CAPABILITIES_TOOL,
  MOS_ROUTES_TOOL,
  MOS_EXECUTE_AUTHORIZED_READ_TOOL,
  READ_QUERY_MAX_LENGTH,
  READ_LIMIT_MIN,
  READ_LIMIT_MAX,
  READ_LIMIT_DEFAULT,
} from "./contract/studio-vocabulary.js";

export {
  sessionStartHookPayloadSchema,
  parseSessionStartHookPayload,
  type SessionStartHookPayload,
} from "./contract/hook-payload.js";

export {
  toolCallMetaSchema,
  sessionFactsFromToolCallMeta,
  type ToolCallMeta,
} from "./contract/session-context.js";

export {
  operatorRecordSchema,
  operatorAsUserIdentity,
  OPERATOR_LOGIN_PROVIDER,
  type OperatorRecord,
} from "./contract/operator.js";

export {
  studioManifestSchema,
  studioHooksSchema,
  STUDIO_SLOT_IDS,
  type StudioManifest,
} from "./contract/manifest-mirror.js";

export type {
  StudioAvailability,
  StudioAvailabilityInput,
  StudioUnavailabilityReason,
  StudioStatusPresentation,
  StudioStatusTone,
  StudioHostState,
  StudioMissionStatus,
} from "./domain/availability.js";
export { resolveStudioAvailability, resolveStudioStatusPresentation } from "./domain/availability.js";

export type {
  MissionView,
  ConnectionView,
  CapabilityInstanceView,
  RouteView,
  RoutesView,
} from "./domain/journey-projection.js";
export {
  missionView,
  connectionView,
  capabilityInstanceView,
  routeView,
  routesView,
} from "./domain/journey-projection.js";

export type {
  StudioSessionContext,
  StudioTenantResolution,
  StudioStatusView,
  StudioReadOutcome,
  CredentialStorePort,
  StudioPorts,
  StudioServiceDeps,
} from "./application/studio-service.js";
export {
  StudioService,
  studioSessionContextFromMeta,
  StudioDataDirUnavailableError,
  StudioTenantUnavailableError,
  StudioInvalidInputError,
  StudioConnectionNotFoundError,
  StudioMissionNotFoundError,
} from "./application/studio-service.js";

export type { OperatorStore } from "./application/operator-store.js";
export {
  createComposioSession,
  ComposioSessionError,
  COMPOSIO_SESSION_TOOLKITS,
  type ComposioSession,
} from "./application/composio-session-client.js";
export {
  studioComposioDiscussionSearchDescriptor,
  studioComposioDiscussionSearchImplementation,
} from "./application/catalog-data.js";

export type { HookRunOutcome } from "./hook/main.js";
export {
  runSessionStartHook,
  readStdinFully,
  hookSessionFactsPort,
} from "./hook/main.js";
