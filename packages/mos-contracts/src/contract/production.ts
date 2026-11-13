import { z } from "zod";
import {
  approvalStateSchema,
  engineStatusSchema,
  experimentOutcomeSchema,
  experimentStatusSchema,
  productionGraphStatusSchema,
  productionJobStatusSchema,
  rightsDecisionSchema,
  rightsKindSchema,
  riskLevelSchema,
  sideEffectSchema,
  transformStatusSchema,
  distributionStatusSchema,
} from "./enums.js";
import { moneySchema, opaqueIdSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * Week 3 additive 契约对象 —— core-contracts-v3.0.yaml §objects
 * （authority 映射见 module-registry-v3.0.yaml：content-artifacts / rights-policy /
 * engines / production / distribution / experiments / learning）。
 *
 * 关键决策锁投影：
 * - 决策锁 #5（无第二执行器）：ProductionJob 只是持久业务状态 + 外部 zcode_execution_ref；
 * - 决策锁 #9（领域零 engine 导入）：ProductionGraph 的 engine 节点只持有不透明 engine id，
 *   解析经 mos-engines 注册表（组合根接线）；
 * - 决策锁 #18（Lab 只提假设）：Experiment 是唯一结果 authority；outcome 只在此可写。
 */

/** Transform —— 对内容/资产的期望操作定义（clip/crop/translate/dub/…）。 */
export const transformSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  version: z.number().int().min(1),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  parameters_schema: z.record(z.string(), z.unknown()),
  required_capability_id: opaqueIdSchema.nullable().default(null),
  side_effect: sideEffectSchema,
  risk_level: riskLevelSchema,
  status: transformStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Transform = z.infer<typeof transformSchema>;

/** Engine —— 执行技术能力的可替换实现（注册表级记录；账户级可用性归能力实例）。 */
export const engineSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  version: z.number().int().min(1),
  display_name: z.string().min(1),
  capability_ids: z.array(opaqueIdSchema).default([]),
  provider_id: opaqueIdSchema.nullable().default(null),
  sandbox_policy: z.record(z.string(), z.unknown()),
  benchmark_refs: z.array(z.string().min(1)).default([]),
  license_terms: z.string().nullable().default(null),
  cost_model: moneySchema.nullable().default(null),
  status: engineStatusSchema,
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Engine = z.infer<typeof engineSchema>;

/** 生产图节点种类（architecture §6 ProductionGraph 定义的组合元素）。 */
export const PRODUCTION_NODE_KINDS = [
  "transform",
  "engine",
  "human",
  "tool",
  "review_gate",
  "budget",
  "deadline",
] as const;
export const productionNodeKindSchema = z.enum(PRODUCTION_NODE_KINDS);
export type ProductionNodeKind = z.infer<typeof productionNodeKindSchema>;

/** 图节点：kind + 不透明引用（transform id / engine id / offer id …由各 authority 解析）。 */
export const productionGraphNodeSchema = z.object({
  id: opaqueIdSchema,
  kind: productionNodeKindSchema,
  /** kind 对应的记录引用：transform 节点 → transform id；engine 节点 → engine id… */
  ref: opaqueIdSchema.nullable().default(null),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type ProductionGraphNode = z.infer<typeof productionGraphNodeSchema>;

export const productionGraphEdgeSchema = z.object({
  from: opaqueIdSchema,
  to: opaqueIdSchema,
});
export type ProductionGraphEdge = z.infer<typeof productionGraphEdgeSchema>;

/** ProductionGraph —— 编译到既有 ZCode workflow 的生产程序描述（非第二执行器）。 */
export const productionGraphSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  version: z.number().int().min(1),
  name: z.string().min(1),
  nodes: z.array(productionGraphNodeSchema).default([]),
  edges: z.array(productionGraphEdgeSchema).default([]),
  status: productionGraphStatusSchema,
  validated_at: rfc3339TimestampSchema.nullable().default(null),
  validation_errors: z.array(z.string().min(1)).default([]),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type ProductionGraph = z.infer<typeof productionGraphSchema>;

/** ProductionJob —— 持久业务状态；执行归 ZCode（外部 execution ref）。 */
export const productionJobSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  graph_id: opaqueIdSchema,
  graph_version: z.number().int().min(1),
  status: productionJobStatusSchema,
  zcode_execution_ref: z.string().min(1).nullable().default(null),
  started_at: rfc3339TimestampSchema.nullable().default(null),
  completed_at: rfc3339TimestampSchema.nullable().default(null),
  output_artifact_refs: z.array(z.string().min(1)).default([]),
  failure: z.string().nullable().default(null),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type ProductionJob = z.infer<typeof productionJobSchema>;

/** RightsRecord —— 权利/同意/许可/平台政策/评审决定（rights authority 的持久记录）。 */
export const rightsRecordSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  kind: rightsKindSchema,
  subject_ref: z.string().min(1),
  subject_artifact_ref: z.string().nullable().default(null),
  constraints: z.array(z.string().min(1)).default([]),
  evidence_refs: z.array(z.string().min(1)).default([]),
  decision: rightsDecisionSchema,
  decided_at: rfc3339TimestampSchema.nullable().default(null),
  expires_at: rfc3339TimestampSchema.nullable().default(null),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type RightsRecord = z.infer<typeof rightsRecordSchema>;

/** DistributionIntent —— provider 发布/更新/删除意图（预览 + 审批绑定后才能执行）。 */
export const distributionIntentSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  operation: z.enum(["publish", "update", "delete"]),
  connection_id: opaqueIdSchema,
  capability_instance_id: opaqueIdSchema,
  artifact_ref: z.string().min(1),
  artifact_version: z.number().int().min(1).nullable().default(null),
  target: z.record(z.string(), z.unknown()),
  preview_ref: z.string().min(1).nullable().default(null),
  preview_hash: z.string().min(1).nullable().default(null),
  approval_state: approvalStateSchema,
  idempotency_key: z.string().min(1).nullable().default(null),
  status: distributionStatusSchema,
  execution_records: z.array(z.string().min(1)).default([]),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type DistributionIntent = z.infer<typeof distributionIntentSchema>;

/** Experiment —— 实际世界实验（决策锁 #18 的结果 authority）。 */
export const experimentSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  mission_id: opaqueIdSchema.nullable().default(null),
  hypothesis_id: opaqueIdSchema.nullable().default(null),
  statement: z.string().min(1),
  design: z.record(z.string(), z.unknown()),
  assignment: z.record(z.string(), z.unknown()).nullable().default(null),
  measurement_evidence_refs: z.array(z.string().min(1)).default([]),
  status: experimentStatusSchema,
  outcome: experimentOutcomeSchema.nullable().default(null),
  outcome_note: z.string().nullable().default(null),
  started_at: rfc3339TimestampSchema.nullable().default(null),
  concluded_at: rfc3339TimestampSchema.nullable().default(null),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Experiment = z.infer<typeof experimentSchema>;

/** CalibrationRecord —— 学习校准（延迟模式；只是建议记录，绝不直接改路线/生产）。 */
export const calibrationRecordSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  experiment_ref: z.string().min(1),
  calibration: z.record(z.string(), z.unknown()),
  recommendation: z.string().nullable().default(null),
  /** 延迟模式安全位：恒为 true（W3 无实时应用路径；新增 API 也不得绕过）。 */
  delayed_mode: z.literal(true),
  evidence_refs: z.array(z.string().min(1)).default([]),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type CalibrationRecord = z.infer<typeof calibrationRecordSchema>;
