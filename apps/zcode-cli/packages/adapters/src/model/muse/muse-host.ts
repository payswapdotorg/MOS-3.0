/**
 * Muse Code 本地宿主管理：懒启动一个 `muse serve`（Muse Session Protocol）子进程，
 * 进程内共享复用，宿主死亡后自动重置以便下次重连。
 *
 * 边界（ACR-0002）：MOS 只通过官方 SDK 驱动本机已登录的 Muse Code CLI，
 * 不读取、不复制、不解析 CLI 的任何凭证存储；凭证与订阅额度完全由 CLI 自己持有。
 */

import { MuseClient, MuseHostDiedError } from "@muse-code/sdk";
import type { Logger } from "@zcode/contracts";

/** 可注入的宿主连接工厂；生产环境默认 MuseClient.spawn（契约测试注入脚本化假对象）。 */
export type MuseClientFactory = (options: {
  readonly args: readonly string[];
  readonly clientInfo: { readonly name: string; readonly version: string };
  readonly museBin?: string;
}) => Promise<MuseClient>;

const defaultMuseClientFactory: MuseClientFactory = (options) =>
  MuseClient.spawn({ ...options, args: [...options.args] });

export interface MuseHostManagerOptions {
  /** 覆盖 muse 可执行文件路径；缺省时由 SDK 在 PATH 上发现（跨平台）。 */
  readonly museBin?: string;
  /** initialize 握手中的客户端标识（SS1.4.1，机器名规范 [a-z0-9_]+）。 */
  readonly clientInfo: { readonly name: string; readonly version: string };
  readonly logger?: Logger;
  readonly onStderr?: (chunk: string) => void;
  /** 测试注入点；生产缺省 MuseClient.spawn。 */
  readonly clientFactory?: MuseClientFactory;
}

/**
 * 单宿主管理器。spawn 是进程级昂贵操作，整个 CLI 进程只维护一个 `muse serve`
 * 连接；多个 MOS 会话/请求通过同一宿主上的多个 MSP session 并发执行。
 */
export class MuseHostManager {
  readonly #options: MuseHostManagerOptions;
  readonly #clientFactory: MuseClientFactory;
  #clientPromise: Promise<MuseClient> | undefined;
  #disposed = false;

  constructor(options: MuseHostManagerOptions) {
    this.#options = options;
    this.#clientFactory = options.clientFactory ?? defaultMuseClientFactory;
  }

  /**
   * 取得（必要时启动）共享宿主连接。失败不缓存：下一次调用重新尝试 spawn，
   * 让 “CLI 未安装 / 未登录 / 版本不兼容” 之类的失败在 UI 上可通过重试恢复。
   */
  getClient(): Promise<MuseClient> {
    if (this.#disposed) {
      return Promise.reject(new Error("MuseHostManager 已 dispose"));
    }
    if (this.#clientPromise === undefined) {
      this.#clientPromise = this.#spawnClient();
    }
    return this.#clientPromise;
  }

  /** 宿主疑似死亡（或任何操作失败）后调用：丢弃连接，下次重连。 */
  resetClient(): void {
    const pending = this.#clientPromise;
    this.#clientPromise = undefined;
    if (pending !== undefined) {
      pending.then(
        (client) => {
          void client.close().catch(() => undefined);
        },
        () => undefined,
      );
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const pending = this.#clientPromise;
    this.#clientPromise = undefined;
    if (pending !== undefined) {
      try {
        const client = await pending;
        await client.close();
      } catch {
        // 关闭失败按已死亡处理；宿主是本机子进程，最多由 OS 回收。
      }
    }
  }

  async #spawnClient(): Promise<MuseClient> {
    const client = await this.#clientFactory({
      args: ["serve"],
      clientInfo: this.#options.clientInfo,
      ...(this.#options.museBin ? { museBin: this.#options.museBin } : {}),
    });
    this.#options.logger?.debug("muse serve host started", {
      museBin: this.#options.museBin ?? "PATH",
    });
    return client;
  }
}

/** 判定一个异常是否是宿主死亡（连接已不可复用，应 resetClient）。 */
export function isMuseHostDeath(error: unknown): boolean {
  return error instanceof MuseHostDiedError;
}
