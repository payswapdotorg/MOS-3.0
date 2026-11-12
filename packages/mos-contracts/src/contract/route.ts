import { z } from "zod";
import { approvalStateSchema, routeClassSchema, routeStatusSchema, sideEffectSchema } from "./enums.js";
import { moneySchema, opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * Route —— core-contracts-v3.0.yaml §objects.Route。
 * required: [id, tenant_id, mission_id, route_class, status, steps, preconditions, approvals]。
 * route_class 枚举保证 existing/conditional/opportunity_constrained/blocked/unknown 可区分；
 * unknowns/risks 必须显式暴露，绝不允许静默回退。
 */
export const routeSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema,
  route_class: routeClassSchema,
  status: routeStatusSchema,
  steps: z.array(
    z.object({
      description: z.string().min(1),
      capability_instance_id: z.string().min(1).nullable().default(null),
      side_effect: sideEffectSchema,
    }),
  ),
  preconditions: z.array(z.string()),
  approvals: z.array(z.string()),
  estimated_cost: moneySchema.nullable().default(null),
  estimated_latency_ms: z.number().int().nonnegative().nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  evidence_refs: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  fallback_route_ids: z.array(z.string()).default([]),
});
export type Route = z.infer<typeof routeSchema>;

/**
 * ExternalActionPreview —— core-contracts-v3.0.yaml §objects.ExternalActionPreview。
 * required: [id, tenant_id, connection_id, capability_instance_id, operation, target,
 *            side_effect, approval_state]。
 * 每个有副作用的外部动作都必须先有预览，并绑定既有 ZCode 权限审批。
 */
export const externalActionPreviewSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  connection_id: opaqueIdSchema,
  capability_instance_id: opaqueIdSchema,
  operation: z.string().min(1),
  target: z.record(z.string(), z.unknown()),
  artifact_id: z.string().nullable().default(null),
  artifact_version: z.number().int().min(1).nullable().default(null),
  scheduled_at: rfc3339TimestampSchema.nullable().default(null),
  estimated_cost: moneySchema.nullable().default(null),
  side_effect: sideEffectSchema,
  approval_state: approvalStateSchema,
  idempotency_key: z.string().nullable().default(null),
  preview_hash: z.string().min(1),
});
export type ExternalActionPreview = z.infer<typeof externalActionPreviewSchema>;
