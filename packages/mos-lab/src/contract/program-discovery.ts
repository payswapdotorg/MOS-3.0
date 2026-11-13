import { z } from "zod";
import {
  nodeOfferSchema,
  opaqueIdSchema,
  rfc3339TimestampSchema,
  routeSchema,
} from "@mos/contracts";
import type { Hypothesis, Mission, NodeOffer, Route } from "@mos/contracts";

/**
 * Program discovery（程序发现）契约：从既有记录（mission + hypotheses + 路由候选 + offers）
 * 推导 lab program suggestions——只引用（绝不复制/发明）既有 route 与 offer 记录；
 * 缺口一律显式落在 missing_preconditions，绝不静默丢弃。
 *
 * 决策锁 #9：无 engine 调用、无 provider 调用、无 LLM 调用——全部事实经输入记录与端口注入。
 */

/**
 * 路由候选事实：既有 Route 记录 + 该路由引用的 capability id 集合。
 * capability_ids 由组合根从路由 steps 的 capability_instance_id 解析配对带来——
 * lab 绝不从 capability_instance_id 猜 capability id（与 mos-routes 的
 * RouteInstanceFact seam 方式一致：副作用由组合根从描述符配对带来）。
 */
export const routeCandidateFactSchema = z.object({
  route: routeSchema,
  capability_ids: z.array(opaqueIdSchema),
});
export type RouteCandidateFact = z.infer<typeof routeCandidateFactSchema>;

/**
 * Lab program suggestion：一条假设对应一个程序建议。
 * route_refs / offer_refs 只引用传入记录的 id（零 fabrication）；
 * missing_preconditions 显式披露不可建议的路由与无 published offer 的能力。
 */
export const labProgramSuggestionSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema,
  hypothesis_id: opaqueIdSchema,
  route_refs: z.array(opaqueIdSchema),
  offer_refs: z.array(opaqueIdSchema),
  missing_preconditions: z.array(z.string().min(1)),
  created_at: rfc3339TimestampSchema,
});
export type LabProgramSuggestion = z.infer<typeof labProgramSuggestionSchema>;

/** 服务编排输入：显式点名要推导程序的假设集合（未命中 → HypothesisNotFoundError）。 */
export const programDiscoveryInputSchema = z.object({
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema,
  hypothesis_ids: z.array(opaqueIdSchema),
});
export type ProgramDiscoveryInput = z.infer<typeof programDiscoveryInputSchema>;

/** 纯推导器输入（domain/program-discovery.ts）：全部事实记录 + 时间锚点。 */
export interface DeriveProgramSuggestionsInput {
  readonly mission: Mission;
  readonly hypotheses: readonly Hypothesis[];
  readonly routeCandidates: readonly RouteCandidateFact[];
  /** capability id → 该能力的 offer 记录（domain 只引用 status=published 的 offer）。 */
  readonly offersByCapability: ReadonlyMap<string, readonly NodeOffer[]>;
  /** RFC3339 UTC 推导时间锚点（必须经 TimePort 获得）。 */
  readonly now: string;
}

/** 假设查找端口：结构化注入；按 (tenantId, hypothesisId) 解析，未命中返回 undefined。 */
export type HypothesisLookup = (
  tenantId: string,
  hypothesisId: string,
) => Hypothesis | undefined;

/** 路由查找端口：结构化注入；按 (tenantId, routeId) 解析，未命中返回 undefined。 */
export type RouteLookup = (tenantId: string, routeId: string) => RouteCandidateFact | undefined;

/** offer 查找端口：结构化注入；按 (tenantId, capabilityId) 返回该能力的 offer 记录（可为空数组）。 */
export type OfferLookup = (
  tenantId: string,
  capabilityId: string,
) => readonly NodeOffer[];

/** 程序引用的路由不存在（或不在调用方租户内）：类型化错误（fail-closed，绝不猜测）。 */
export class RouteNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly routeId: string,
    public readonly referencedBy: string | null = null,
  ) {
    super(
      referencedBy === null
        ? `route ${routeId} not found for tenant ${tenantId}`
        : `route ${routeId} not found for tenant ${tenantId} (referenced by hypothesis ${referencedBy})`,
    );
    this.name = "RouteNotFoundError";
  }
}
