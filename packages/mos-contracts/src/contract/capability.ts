import { z } from "zod";
import { capabilitySupportSchema, implementationStatusSchema, riskLevelSchema, sideEffectSchema } from "./enums.js";
import { contractVersionSchema, opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * Capability —— core-contracts-v3.0.yaml §objects.Capability。
 * required: [id, version, domain, input_schema, output_schema, side_effect, support_status]。
 * 描述符只是"可能存在的映射"，绝不构成账户授权证明。
 */
export const capabilitySchema = z.object({
  id: opaqueIdSchema,
  version: contractVersionSchema,
  domain: z.string().min(1),
  description: z.string().default(""),
  input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()),
  side_effect: sideEffectSchema,
  support_status: capabilitySupportSchema,
  required_scopes: z.array(z.string()).default([]),
  required_account_types: z.array(z.string()).default([]),
  risk_level: riskLevelSchema.default("unknown"),
});
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * ProviderImplementation —— core-contracts-v3.0.yaml §objects.ProviderImplementation。
 * required: [id, provider_id, capability_id, version, operation_mapping, status]。
 * operation_mapping 只允许映射到在真实 provider 适配器中核实过的工具名。
 */
export const providerImplementationSchema = z.object({
  id: opaqueIdSchema,
  provider_id: opaqueIdSchema,
  capability_id: opaqueIdSchema,
  version: contractVersionSchema,
  operation_mapping: z.array(
    z.object({
      tool_name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  required_scopes: z.array(z.string()).default([]),
  rate_limit_notes: z.string().nullable().default(null),
  cost_model: z.record(z.string(), z.unknown()).nullable().default(null),
  latency_model: z.record(z.string(), z.unknown()).nullable().default(null),
  status: implementationStatusSchema,
  evidence_refs: z.array(z.string()).default([]),
});
export type ProviderImplementation = z.infer<typeof providerImplementationSchema>;

/**
 * CapabilityInstance —— core-contracts-v3.0.yaml §objects.CapabilityInstance。
 * required: [id, tenant_id, connection_id, capability_id, implementation_id,
 *            support_status, status, checked_at]。
 * 不变量：除非有一次实时连接/账户检查与 scope 检查支撑，实例绝不可能是 available。
 */
export const capabilityInstanceSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  connection_id: opaqueIdSchema,
  capability_id: opaqueIdSchema,
  implementation_id: opaqueIdSchema,
  support_status: capabilitySupportSchema,
  status: implementationStatusSchema,
  available_quota: z.record(z.string(), z.unknown()).nullable().default(null),
  constraints: z.array(z.string()).default([]),
  missing_preconditions: z.array(z.string()).default([]),
  checked_at: rfc3339TimestampSchema,
  evidence_refs: z.array(z.string()).default([]),
});
export type CapabilityInstance = z.infer<typeof capabilityInstanceSchema>;
