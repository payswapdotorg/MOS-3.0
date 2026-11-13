import { z } from "zod";
import { ContractValidationError, opaqueIdSchema } from "@mos/contracts";
import { nodeRefSchema, offerAvailabilitySchema } from "@mos/contracts";
import type { Engine, NodeOffer } from "@mos/contracts";

/**
 * mos-resource-network 契约 —— 网络节点登记（NetworkNode）与跨模块发现端口。
 *
 * 代码级依赖只有 @mos/contracts（module-registry 的 mos-agent-organizations /
 * mos-capabilities / mos-engines 依赖经 OfferLookup / EngineLookup 结构化端口在
 * 组合根接线解析 —— mos-lab OfferLookup 同一先例；节点引用一律不透明 id 字符串）。
 */

/** 节点登记输入：id/now 由调用方注入（领域层零 Date/random）。 */
export const networkNodeRegistrationInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  node_ref: nodeRefSchema,
  display_name: z.string().min(1),
  evidenced_capability_ids: z.array(opaqueIdSchema).default([]),
  availability: offerAvailabilitySchema,
  geography: z.string().nullable(),
  language: z.string().nullable(),
  evidence_refs: z.array(z.string().min(1)).default([]),
});
export type NetworkNodeRegistrationInput = z.infer<typeof networkNodeRegistrationInputSchema>;

/** 生命周期词表（与 @mos/contracts networkNodeStatusSchema 同源；登记恒为 active）。 */
export const NETWORK_NODE_STATUS_ACTIVE = "active" as const;
export const NETWORK_NODE_STATUS_INACTIVE = "inactive" as const;

/** 节点不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测）。 */
export class NetworkNodeNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly nodeId: string,
  ) {
    super(`network node ${nodeId} not found for tenant ${tenantId}`);
    this.name = "NetworkNodeNotFoundError";
  }
}

/** 节点登记/记录校验失败（ContractValidationError 的类型化投影）。 */
export class NetworkNodeValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("NetworkNode", [...issues]);
    this.name = "NetworkNodeValidationError";
  }
}

/**
 * 服务要约查询端口：组合根把 (tenant, capabilityId) 解析到
 * @mos/agent-organizations 的 NodeOffer 记录（按 capability_id 过滤的全部状态记录，
 * 不只是 published —— 发现层负责 fail-closed 状态过滤并具名浮出被排除项，§26）。
 */
export type OfferLookup = (tenantId: string, capabilityId: string) => readonly NodeOffer[];

/**
 * 引擎查询端口：组合根把 (tenant, capabilityId) 解析到 @mos/engines 注册表里
 * 覆盖该 capability 的引擎记录（状态过滤与浮出归发现层，deprecated 绝不静默隐藏）。
 */
export type EngineLookup = (tenantId: string, capabilityId: string) => readonly Engine[];
