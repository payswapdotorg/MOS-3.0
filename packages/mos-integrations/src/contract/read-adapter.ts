import type { ClassifiedProviderError, ProviderErrorAction } from "@mos/adapters";
import type { Evidence } from "@mos/contracts";

/**
 * 读适配器公共契约（provider-neutral）。
 * - 查询输入与工具参数是 MOS 自己的词汇，不承诺任何 provider 私有形状；
 * - 成功只产出"证据 + 结果形状"，原始负载绝不内嵌（secrets/data 约定）；
 * - 失败只产出错误公共语言（ClassifiedProviderError）+ 失效动作，不抛裸异常。
 */

/** 联系人读查询：provider-neutral 输入。 */
export interface ContactsReadQuery {
  readonly searchText: string;
  readonly limit?: number;
}

/**
 * 结果形状摘要：只有计数与形状（字段名/块类型/顶层键），没有任何记录值。
 * recordCount 为 null 表示"未知"，绝不猜值（core-contracts 未知值约定）。
 */
export interface ProviderReadShape {
  readonly recordCount: number | null;
  readonly recordCountBasis: "structured_content" | "text_json" | null;
  readonly contentBlockCount: number;
  readonly contentBlockTypes: readonly string[];
  readonly structuredContentKeys: readonly string[] | null;
  readonly recordFields: readonly string[] | null;
}

export interface ContactsReadSuccess {
  readonly status: "succeeded";
  readonly evidence: Evidence;
  readonly resultShape: ProviderReadShape;
}

export interface ContactsReadFailure {
  readonly status: "failed";
  readonly classified: ClassifiedProviderError;
  readonly action: ProviderErrorAction;
  readonly invalidatedInstance: boolean;
}

export type ContactsReadOutcome = ContactsReadSuccess | ContactsReadFailure;

/**
 * fail-closed 类型化错误：tenant 无该连接时读操作绝不静默降级
 * （不换 tenant、不编造连接、不发起 provider 调用）。
 */
export class ConnectionNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly providerId: string,
    public readonly connectionId: string,
  ) {
    super(`connection ${connectionId} not found for tenant (provider: ${providerId})`);
    this.name = "ConnectionNotFoundError";
  }
}
