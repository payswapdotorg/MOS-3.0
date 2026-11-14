import { z } from "zod";
// Meta Muse Code 本地执行后端契约（Issue #24）。
//
// 边界（ACR-0002）：
// - Muse Code 是「本地 agent runtime 执行后端」，不是 model provider。绝不进入
//   Provider Registry（provider schema 是 HTTP-only 的 fail-closed 枚举），也绝不
//   复用 OpenRouter / Meta Model API 计费路径。
// - 该后端只消耗用户已在本机 `muse` CLI 完成的订阅登录；MOS 不读取、不复制、
//   不展示 CLI 的任何凭据材料。
// - 凭据与探针纪律：所有状态只来自可观察的 CLI 进程行为（退出码 / stdout），
//   状态对象中不允许出现 token、cookie、header 等字段。

/** 唯一受支持的 delegated execution backend id；缺省字段 = 普通 ZCode 执行路径。 */
export const MUSE_CODE_EXECUTION_BACKEND = "muse-code" as const;
export type MuseCodeExecutionBackendId = typeof MUSE_CODE_EXECUTION_BACKEND;

/**
 * 官方 Muse Session Protocol（MSP）TypeScript SDK 的固定版本（PR #27 评审 R1）。
 * 官方 README：「This package versions in lockstep with Muse Code: the SDK
 * version is the Muse Code release it ships with」——SDK X.Y.Z 与 CLI X.Y.Z 配对，
 * 必须 exact pin（不使用 ^ 范围）。CLI 版本 >= 该配对版本时端口选择 MSP
 * （`muse serve` + `@muse-code/sdk`）；更旧/无法解析的 CLI 回退到 `muse exec --json`
 * （同样是 documented headless 界面）。SDK 自述 developer preview，真实
 * Windows CLI 的兼容性在机验证（见 evidence §4）。
 */
export const MUSE_CODE_SDK_PINNED_VERSION = "1.4.20" as const;

/** delegated 轮的实际执行面（端口运行时选择，结果如实回传 core 供归因）。 */
export type MuseCodeExecutionSurface = "muse-exec" | "session-protocol";

/** 无陪同（headless）执行的事前审批姿态（PR #27 评审 R3；Meta 文档要求 headless 必须事前选姿态）。 */
export type MuseCodeApprovalPosture = "fail-closed" | "unattended-sandboxed";

export const MUSE_CODE_APPROVAL_POSTURES: readonly MuseCodeApprovalPosture[] = [
  "fail-closed",
  "unattended-sandboxed",
];

/** 执行面选择：auto = 按 CLI 版本门控；显式值 = 用户知情覆盖（诊断/验收用）。 */
export type MuseCodeExecutionSurfaceSetting = "auto" | MuseCodeExecutionSurface;

export const MUSE_CODE_EXECUTION_SURFACES: readonly MuseCodeExecutionSurfaceSetting[] = [
  "auto",
  "muse-exec",
  "session-protocol",
];

/** 宽容解析 `muse --version` 的 major/minor/patch；解析不出返回 undefined（不猜测）。 */
export function parseMuseCliVersionParts(
  version: string | undefined,
): { major: number; minor: number; patch: number } | undefined {
  if (!version) return undefined;
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return undefined;
  }
  return { major, minor, patch };
}

/**
 * 执行面选择（bootstrap 端口与 Host 侧视图共用同一判定）：
 * - 显式 settings.executionSurface 优先（用户知情覆盖）。
 * - auto：CLI 版本可解析且 >= SDK 锁步配对版本 → session-protocol；否则 muse-exec
 *   （旧 CLI / 版本未知 → 保守回退到所有版本都 documented 的 exec 界面）。
 */
export function selectMuseExecutionSurface(input: {
  cliVersion?: string;
  settings: Pick<MuseCodeBackendSettings, "executionSurface">;
}): MuseCodeExecutionSurface {
  if (input.settings.executionSurface === "muse-exec") return "muse-exec";
  if (input.settings.executionSurface === "session-protocol") return "session-protocol";
  const installed = parseMuseCliVersionParts(input.cliVersion);
  const pinned = parseMuseCliVersionParts(MUSE_CODE_SDK_PINNED_VERSION);
  if (!installed || !pinned) return "muse-exec";
  if (installed.major !== pinned.major) {
    return installed.major > pinned.major ? "session-protocol" : "muse-exec";
  }
  if (installed.minor !== pinned.minor) {
    return installed.minor > pinned.minor ? "session-protocol" : "muse-exec";
  }
  return installed.patch >= pinned.patch ? "session-protocol" : "muse-exec";
}

/** v4 command envelope / payload 上的 additive 选择字段；旧端会剥掉，必须由 capability 门控。 */
export const executionBackendSchema = z.literal(MUSE_CODE_EXECUTION_BACKEND);
export type ExecutionBackendSelection = z.infer<typeof executionBackendSchema>;

/** CLI 安装探测结果。auth/contributor 只能来自已验证的探针命令输出，不允许凭空推断。 */
export const museCodeCliStatusSchema = z
  .object({
    /** unavailable = 未安装或探测失败（fail-closed，展示为不可用）。 */
    state: z.enum(["unavailable", "installed"]),
    /** `muse --version` 输出的版本串（已裁剪；未解析到时缺省）。 */
    version: z.string().min(1).max(128).optional(),
    /** 只允许来自已配置且验证过的 status 探针命令；undefined = 未知（不猜测）。 */
    authenticated: z.boolean().optional(),
    contributorMode: z.boolean().optional(),
    planLabel: z.string().min(1).max(128).optional(),
    /** 解析到的可执行入口（仅用于诊断展示；不是凭据）。 */
    executablePath: z.string().min(1).max(1024).optional(),
    checkedAt: z.string().min(1),
    /** 探测失败的稳定原因码（不含进程输出原文，避免泄漏环境细节）。 */
    probeIssueCode: z
      .enum([
        "executableNotFound",
        "versionProbeFailed",
        "versionProbeTimeout",
        "statusProbeFailed",
      ])
      .optional(),
  })
  .strict();
export type MuseCodeCliStatus = z.infer<typeof museCodeCliStatusSchema>;

/**
 * 后端行为设置（Host 侧持久化，路径由服务装配决定；文件权限私有）。
 * loginCommand / statusProbeCommand 是用户在核对 `muse --help` 后显式录入的
 * documented 命令切片；MOS 不内置未经验证的 CLI 子命令。
 */
export const museCodeBackendSettingsSchema = z
  .object({
    /** true = New Task 的 createSession/sendText 信封携带 executionBackend。 */
    useAsTaskBackend: z.boolean(),
    /** 覆盖 muse 可执行入口（绝对路径）；缺省 = PATH 解析。 */
    executablePath: z.string().min(1).max(1024).optional(),
    /** documented 登录命令切片，例如 ["login"]；未验证/未配置时 Connect 引导用户先核对 --help。 */
    loginCommand: z.array(z.string().min(1).max(128)).max(8).optional(),
    /** documented 状态探针切片，例如 ["auth","status"]；输出按 JSON 或文本启发式宽容解析。 */
    statusProbeCommand: z.array(z.string().min(1).max(128)).max(8).optional(),
    /** 单次 muse exec 的总超时（毫秒）；0/缺省 = 服务默认。 */
    timeoutMs: z.number().int().min(0).max(86_400_000).optional(),
    /** 传递给 documented `--max-model-steps` 的上限；缺省不传。 */
    maxModelSteps: z.number().int().min(1).max(10_000).optional(),
    /**
     * 无陪同审批姿态（PR #27 评审 R3；Meta 文档：headless 必须事前选姿态）：
     * - fail-closed（缺省）：exec 面不传任何审批旗标（提示无人应答时由超时收口）；
     *   MSP 面注册审批回调，只选服务端 offered 的 deny/abort 选项，绝不 auto-approve。
     * - unattended-sandboxed：exec 面附加 documented `--disable-approval`（sandbox 保持
     *   开启）；MSP 面 startSession approvalMode "allowAll"（sandbox 仍独立生效）。
     * `--yolo` / 关闭 sandbox 永远不在取值域内（ACR-0002 红线）。
     */
    approvalPosture: z.enum(["fail-closed", "unattended-sandboxed"]).optional(),
    /**
     * 执行面选择（PR #27 评审 R1）：auto（缺省）= CLI >= SDK 锁步配对版本走 MSP
     * （`muse serve` + `@muse-code/sdk`），否则回退 `muse exec --json`；显式值供
     * 在机验收/诊断（覆盖旧 CLI 或强制 MSP 失败暴露）。
     */
    executionSurface: z.enum(["auto", "muse-exec", "session-protocol"]).optional(),
  })
  .strict();
export type MuseCodeBackendSettings = z.infer<typeof museCodeBackendSettingsSchema>;

export const DEFAULT_MUSE_CODE_BACKEND_SETTINGS: MuseCodeBackendSettings = {
  useAsTaskBackend: false,
};

/** 服务默认单次执行超时：30 分钟（长任务可经设置调大）。 */
export const DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS = 30 * 60 * 1000;
