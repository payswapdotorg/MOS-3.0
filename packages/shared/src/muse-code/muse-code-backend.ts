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
  })
  .strict();
export type MuseCodeBackendSettings = z.infer<typeof museCodeBackendSettingsSchema>;

export const DEFAULT_MUSE_CODE_BACKEND_SETTINGS: MuseCodeBackendSettings = {
  useAsTaskBackend: false,
};

/** 服务默认单次执行超时：30 分钟（长任务可经设置调大）。 */
export const DEFAULT_MUSE_CODE_EXEC_TIMEOUT_MS = 30 * 60 * 1000;
