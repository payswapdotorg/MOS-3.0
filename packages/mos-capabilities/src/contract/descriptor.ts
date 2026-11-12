import { z } from "zod";
import {
  capabilitySupportSchema,
  contractVersionSchema,
  opaqueIdSchema,
  rfc3339TimestampSchema,
  riskLevelSchema,
  sideEffectSchema,
} from "@mos/contracts";

/**
 * MOS 能力描述符 —— provider-integration-strategy-v3.0.md §3 的机读投影。
 * "versioned metadata adjacent to a connector package"：描述符只声明可能存在的映射，
 * 绝不构成账户授权证据；实际能力判定由 fail-closed 的实例解析器（domain/resolve-instance.ts）
 * 基于具体连接做出。
 *
 * permissionMode 固定为 "zcode_existing_permissions"：MOS 不得建立第二权限系统
 * （strategy §4 / AGENTS.md §4），所有工具执行仍走既有 ZCode 权限边界。
 */

/** 工具映射：verified=false 表示工具名未经 live provider server 枚举核实。 */
export const descriptorToolMappingSchema = z.object({
  toolName: z.string().min(1),
  verified: z.boolean(),
  verifiedAt: rfc3339TimestampSchema.nullable(),
});
export type DescriptorToolMapping = z.infer<typeof descriptorToolMappingSchema>;

/** 证据来源：外部事实必须 source + observed_at（core-contracts 证据约定）。 */
export const descriptorEvidenceSourceSchema = z.object({
  documentationUrl: z.string().min(1),
  observedAt: rfc3339TimestampSchema,
});
export type DescriptorEvidenceSource = z.infer<typeof descriptorEvidenceSourceSchema>;

export const capabilityDescriptorSchema = z.object({
  /** 描述符自身 id（同一 capability 可有多版本描述符）。 */
  id: opaqueIdSchema,
  /** 描述符 schema 版本（破坏性变更必须 bump）。 */
  version: contractVersionSchema,
  domain: z.string().min(1),
  description: z.string().default(""),
  /** 稳定的 capability id（描述符声明它映射到哪个 MOS 能力）。 */
  capabilityId: opaqueIdSchema,
  /** provider 标识（§3 "provider and integration package identifiers"；与 provider 描述符、连接记录的 provider_id 同源）。 */
  providerId: z.string().min(1),
  /** integration 标识（描述符相邻的 connector 模板包名，如 mos-hubspot-connector）。 */
  integrationId: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  sideEffect: sideEffectSchema,
  riskLevel: riskLevelSchema,
  requiredScopes: z.array(z.string()).default([]),
  requiredAccountTypes: z.array(z.string()).default([]),
  /** required app review 状态（无要求时显式 null，绝不省略）。 */
  requiredAppReview: z.string().nullable(),
  /** 只允许既有 ZCode 权限模式：MOS 不建第二权限系统。 */
  permissionMode: z.literal("zcode_existing_permissions"),
  evidenceSource: descriptorEvidenceSourceSchema,
  knownGaps: z.array(z.string()).default([]),
  supportStatus: capabilitySupportSchema,
  /** 回退/对齐规则说明（无回退时显式 null）。 */
  fallback: z.string().nullable(),
  toolMapping: descriptorToolMappingSchema,
});
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
/** 注册用输入形状（带默认值字段可省略）。 */
export type CapabilityDescriptorInput = z.input<typeof capabilityDescriptorSchema>;
