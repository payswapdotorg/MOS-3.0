import { z } from "zod";
import { actorKindSchema, artifactKindSchema, evidenceKindSchema, qualityStatusSchema, rightsStatusSchema } from "./enums.js";
import { contractVersionSchema, opaqueIdSchema, opaqueRefSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * Evidence —— core-contracts-v3.0.yaml §objects.Evidence。
 * required: [id, tenant_id, kind, observed_at, source, confidence]。
 * 每个观测事实必须有 source 与 observed_at；simulation 绝不能存成 provider 观测。
 */
export const evidenceSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  kind: evidenceKindSchema,
  observed_at: rfc3339TimestampSchema,
  source: z.record(z.string(), z.unknown()),
  subject_ref: z.string().nullable().default(null),
  facts: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable(),
  limitations: z.array(z.string()).default([]),
  raw_payload_ref: opaqueRefSchema.nullable().default(null),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Artifact —— core-contracts-v3.0.yaml §objects.Artifact。
 * required: [id, tenant_id, kind, version, provenance, rights_status]。
 * 版本与父系血缘不可变（invariants §7）。
 */
export const artifactSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  kind: artifactKindSchema,
  version: contractVersionSchema,
  content_ref: z.string().min(1),
  parent_artifact_refs: z.array(z.string()).default([]),
  transform_id: z.string().nullable().default(null),
  created_by: z.object({
    actor_kind: actorKindSchema,
    actor_id: z.string(),
  }),
  provenance: z.array(
    z.object({
      source: z.string(),
      observed_at: rfc3339TimestampSchema,
    }),
  ),
  rights_status: rightsStatusSchema,
  quality_status: qualityStatusSchema,
  created_at: rfc3339TimestampSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

/**
 * DomainEvent —— core-contracts-v3.0.yaml §objects.DomainEvent。
 * required: [id, tenant_id, aggregate_type, aggregate_id, aggregate_version,
 *            event_type, occurred_at, payload]。
 */
export const domainEventSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  aggregate_type: z.string().min(1),
  aggregate_id: opaqueIdSchema,
  aggregate_version: contractVersionSchema,
  event_type: z.string().min(1),
  occurred_at: rfc3339TimestampSchema,
  actor: z.record(z.string(), z.unknown()),
  correlation_id: z.string().min(1),
  causation_id: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEvent = z.infer<typeof domainEventSchema>;
