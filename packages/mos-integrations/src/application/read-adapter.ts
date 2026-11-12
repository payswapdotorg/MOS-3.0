import { randomUUID } from "node:crypto";
import {
  classifyProviderError,
  providerErrorAction,
  type ProviderCallToolRequest,
  type ProviderPort,
  type TimePort,
} from "@mos/adapters";
import {
  assertEvidenceProvenance,
  evidenceSchema,
  parseOrFail,
  type Evidence,
} from "@mos/contracts";
import {
  HUBSPOT_SEARCH_CONTACTS_TOOL,
  hubspotProviderDescriptor,
} from "../contract/hubspot-descriptor.js";
import {
  ConnectionNotFoundError,
  type ContactsReadOutcome,
  type ContactsReadQuery,
} from "../contract/read-adapter.js";
import { summarizeProviderReadResult } from "../domain/read-summary.js";
import type { ConnectionStore } from "./connection-store.js";

/**
 * HubSpot 读适配器：一条 provider-neutral 读命令（contract-level stand-in 起步）。
 *
 * - 工具名取自 provider 描述符的 UNVERIFIED 候选（toolMappingVerified=false，
 *   见 hubspot-connector-evidence.md：live 工具名未核实）。本适配器不据此宣称
 *   任何账户能力；能力判定归 mos-capabilities 的实例解析器。
 * - 失败路径：provider 错误 → classifyProviderError（公共语言）→
 *   providerErrorAction → invalidatedInstance（unauthorized/insufficient_scope/
 *   wrong_account 才失效实例）。绝不重试、绝不吞错。
 * - 成功路径：只产出 Evidence（provider_response；source+observed_at 齐备；
 *   facts 只含计数/形状，原始负载绝不内嵌）+ 结果形状。
 * - 连接缺失：类型化错误 ConnectionNotFoundError，且绝不发起 provider 调用。
 */
export class HubSpotReadAdapter {
  private readonly provider: ProviderPort;
  private readonly time: TimePort;
  private readonly store: ConnectionStore;

  constructor(deps: { provider: ProviderPort; time: TimePort; store: ConnectionStore }) {
    this.provider = deps.provider;
    this.time = deps.time;
    this.store = deps.store;
  }

  async readContactsOnce(input: {
    tenantId: string;
    connectionId: string;
    query: ContactsReadQuery;
  }): Promise<ContactsReadOutcome> {
    const connection = await this.store.getConnection(
      input.tenantId,
      hubspotProviderDescriptor.providerId,
      input.connectionId,
    );
    if (connection === null) {
      throw new ConnectionNotFoundError(
        input.tenantId,
        hubspotProviderDescriptor.providerId,
        input.connectionId,
      );
    }

    // provider-neutral 读命令：MOS 查询词汇 → 候选工具参数（参数名同样 UNVERIFIED）。
    const request: ProviderCallToolRequest = {
      serverName: hubspotProviderDescriptor.providerId,
      toolName: HUBSPOT_SEARCH_CONTACTS_TOOL,
      arguments: contactsReadArguments(input.query),
    };
    const result = await this.provider.callTool(request);

    if (result.isError) {
      const classified = classifyProviderError({ content: result.content });
      const action = providerErrorAction(classified.kind);
      return {
        status: "failed",
        classified,
        action,
        invalidatedInstance: action === "invalidate_instance",
      };
    }

    const shape = summarizeProviderReadResult(result);
    const evidence = buildReadEvidence({
      tenantId: input.tenantId,
      connectionId: connection.id,
      toolName: HUBSPOT_SEARCH_CONTACTS_TOOL,
      observedAt: this.time.now(),
      shape,
    });
    return { status: "succeeded", evidence, resultShape: shape };
  }
}

/** 查询 → 候选工具参数（纯映射；limit 未提供时不注入）。 */
function contactsReadArguments(query: ContactsReadQuery): Record<string, unknown> {
  const argumentsRecord: Record<string, unknown> = { query: query.searchText };
  if (query.limit !== undefined) {
    argumentsRecord["limit"] = query.limit;
  }
  return argumentsRecord;
}

/** Evidence 构造（契约校验 + 来源不变量守卫；facts 只含计数/形状）。 */
function buildReadEvidence(input: {
  tenantId: string;
  connectionId: string;
  toolName: string;
  observedAt: string;
  shape: ReturnType<typeof summarizeProviderReadResult>;
}): Evidence {
  const evidence = parseOrFail("Evidence", evidenceSchema, {
    id: randomUUID(),
    tenant_id: input.tenantId,
    kind: "provider_response",
    observed_at: input.observedAt,
    source: {
      observed_via: "hubspot-mcp",
      tool: input.toolName,
      connection_id: input.connectionId,
    },
    subject_ref: null,
    facts: {
      record_count: input.shape.recordCount,
      record_count_basis: input.shape.recordCountBasis,
      content_block_count: input.shape.contentBlockCount,
      content_block_types: [...input.shape.contentBlockTypes],
      structured_content_keys:
        input.shape.structuredContentKeys === null
          ? null
          : [...input.shape.structuredContentKeys],
      record_fields: input.shape.recordFields === null ? null : [...input.shape.recordFields],
    },
    confidence: null,
    limitations: ["contract-level stand-in or live read per provider evidence record"],
    raw_payload_ref: null,
  }) as Evidence;
  assertEvidenceProvenance(evidence);
  return evidence;
}
