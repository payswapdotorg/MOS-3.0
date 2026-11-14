/**
 * Muse Code（本地 CLI）delegated execution backend（ACR-0002）。
 * 对外仅暴露适配器、探测与策略纯函数；MSP/SDK 细节不越出本目录。
 */

export {
  MuseHostManager,
  isMuseHostDeath,
  type MuseHostManagerOptions,
} from "./muse-host.js";
export {
  MuseSessionModelAdapter,
  toModelStartupError,
  type CreateMuseSessionModelOptions,
  type MuseSessionModelAdapterOptions,
} from "./muse-session-model.js";
export {
  MuseTurnEventReducer,
  toModelUsage,
  type MuseItemDeltaParams,
  type MuseTurnCompletedParams,
} from "./muse-event-mapper.js";
export {
  MUSE_REASONING_EFFORTS,
  renderMuseTurnPrompt,
  toMuseReasoningEffort,
  type MuseReasoningEffort,
} from "./muse-request-mapper.js";
export {
  DEFAULT_MUSE_TOOL_APPROVAL_POLICY,
  MUSE_TOOL_APPROVAL_ENV_VAR,
  decideMuseApproval,
  resolveMuseToolApprovalPolicy,
  type MuseToolApprovalPolicyName,
} from "./muse-approval-policy.js";
export {
  parseMuseUsageJson,
  parseMuseVersionOutput,
  probeMuseCliCommands,
  probeMuseRuntime,
  type MuseCliCommandProbeResult,
  type MuseProbeOptions,
  type MuseRuntimeModelSummary,
  type MuseRuntimeProbeResult,
} from "./muse-detection.js";
