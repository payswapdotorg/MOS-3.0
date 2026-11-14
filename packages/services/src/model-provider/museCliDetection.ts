import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * Muse CLI 探测结果（Issue #24 §3，ACR-0002）。
 *
 * 只承载 documented CLI 命令（`muse --version` / `muse usage --json`）产出的公开事实：
 * 是否安装、版本号、CLI 自身登录态与订阅额度摘要。MOS 不保存、不转发任何凭证，
 * 也不携带环境变量或命令路径之外的进程信息。
 */
export interface MuseCliStatus {
  readonly installed: boolean;
  /** `muse --version` 输出中解析出的版本号；安装但解析失败时缺省。 */
  readonly version?: string;
  /** `muse usage --json` 退出码 0 且解析成功 => true；输出含 "not logged in" => false；未知时缺省。 */
  readonly signedIn?: boolean;
  /** 解析后的订阅额度 JSON（容忍未知字段，仅额度事实）。 */
  readonly usage?: Record<string, unknown>;
  /** 探测失败时的有界错误摘要（约 200 字符内，不含 env / 路径）。 */
  readonly error?: string;
}

/**
 * Muse CLI 探测服务：Model Settings 需要在不引入 SDK、不触碰凭证的前提下
 * 展示本机 Muse Code CLI 的安装与登录状态（Issue #24 §3）。
 */
export interface IMuseCliDetectionService {
  getStatus(): Promise<MuseCliStatus>;
  /** 后台启动 `muse login`（浏览器设备码流程，自动开浏览器）；立即返回。 */
  startLogin(): Promise<{ readonly started: boolean; readonly message?: string }>;
  /** `muse logout`（documented；清除 CLI 自己存的会话与 Key）。 */
  logout(): Promise<{ readonly ok: boolean; readonly message?: string }>;
}

export const IMuseCliDetectionService = createServiceDescriptor<IMuseCliDetectionService>(
  ServiceChannels.MuseCliDetection,
);
