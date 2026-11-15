import type {
  MuseCodeBackendSettings,
  MuseCodeCliStatus,
  MuseCodeExecutionSurface,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { ZCodeAgentWorkspaceTarget } from "../zcode-agent/zcodeAgent.js";

// Meta Muse Code 本地执行后端的 Host 服务面（Issue #24 / ACR-0002）。
//
// 职责边界：
// - 只做「状态探测 + 设置持久化 + 登录命令启动」；任务执行本身由 CLI agent
//   进程内的 MuseExecutionPort 完成（信封级 executionBackend 字段路由）。
// - 状态探测只消费可观察的 CLI 进程行为（退出码 / stdout）；绝不读取、复制或
//   展示 CLI 的凭据材料（token / cookie / header），状态对象里也不允许出现。
// - auth / contributor 状态只来自用户显式配置的 documented 状态探针命令
//   （settings.statusProbeCommand）；未配置 = 未知（不猜测）。

/** renderer 聚合视图：CLI 状态 + 设置 + 当前 workspace 的 CLI 能力。 */
export interface MuseCodeBackendView {
  status: MuseCodeCliStatus;
  settings: MuseCodeBackendSettings;
  /** 当前 workspace 的 CLI 是否声明 executionBackendMuseCode；false = 后端不可选（fail-closed）。 */
  backendSupported: boolean;
  /**
   * 当前设置/版本下将使用的执行面（PR #27 评审 R1；与 bootstrap 端口同一判定
   * selectMuseExecutionSurface）：显式设置优先，auto 按 CLI 版本门控；版本未知 =
   * muse-exec 回退。展示用途，真相在端口侧逐轮回传 result.surface。
   */
  executionSurface: MuseCodeExecutionSurface;
}

export interface MuseCodeLaunchLoginResult {
  launched: boolean;
  reason?: "loginCommandNotConfigured" | "launchFailed";
}

export interface IMuseCodeService {
  /** 聚合视图（使用缓存状态；首次调用会探测）。 */
  getView(target?: ZCodeAgentWorkspaceTarget): Promise<MuseCodeBackendView>;
  /** 强制重跑 CLI 探测（Recheck 动作）。 */
  recheck(target?: ZCodeAgentWorkspaceTarget): Promise<MuseCodeBackendView>;
  /** 全量保存设置（schema 校验；持久化为私有权限文件）。 */
  saveSettings(settings: MuseCodeBackendSettings): Promise<MuseCodeBackendSettings>;
  /**
   * 启动 documented 登录命令（settings.loginCommand；detached，不等待、不收集输出）。
   * 未配置时返回 loginCommandNotConfigured，UI 引导用户先核对 `muse --help`。
   */
  launchLogin(): Promise<MuseCodeLaunchLoginResult>;
}

export const IMuseCodeService = createServiceDescriptor<IMuseCodeService>(ServiceChannels.MuseCode);
