import { z } from "zod";
import {
  contractVersionSchema,
  moneySchema,
  nullableStringSchema,
  opaqueIdSchema,
  rfc3339TimestampSchema,
} from "./common.js";

/**
 * Mission —— core-contracts-v3.0.yaml §objects.Mission。
 * required: [id, version, tenant_id, objective, created_at, status]。
 * objective 一律按用户原话逐字存入（verbatim intake；零推断），
 * 派生字段（target_audience/geography/budget/...）未提供时必须为 null，不得猜测。
 */
export const missionSchema = z.object({
  id: opaqueIdSchema,
  version: contractVersionSchema,
  tenant_id: opaqueIdSchema,
  workspace_id: opaqueIdSchema,
  objective: z.string().min(1),
  target_audience: nullableStringSchema,
  geography: nullableStringSchema,
  desired_outcomes: z.array(z.string()),
  constraints: z.record(z.string(), z.unknown()),
  budget: moneySchema.nullable(),
  deadline: rfc3339TimestampSchema.nullable(),
  success_metrics: z.array(z.string()),
  source_zcode_session_id: nullableStringSchema,
  source_zcode_task_id: nullableStringSchema,
  status: z.string().min(1),
  created_at: rfc3339TimestampSchema,
  updated_at: rfc3339TimestampSchema,
});
export type Mission = z.infer<typeof missionSchema>;

/** 逐字 intake 输入：只有 objective 与既有 ZCode 关联是必须的，其余一律 nullable。 */
export const missionIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  workspace_id: opaqueIdSchema,
  objective_verbatim: z.string().min(1),
  source_zcode_session_id: nullableStringSchema,
  source_zcode_task_id: nullableStringSchema,
  target_audience: nullableStringSchema.default(null),
  geography: nullableStringSchema.default(null),
  desired_outcomes: z.array(z.string()).default([]),
  success_metrics: z.array(z.string()).default([]),
  budget: moneySchema.nullable().default(null),
  deadline: rfc3339TimestampSchema.nullable().default(null),
});
export type MissionIntake = z.infer<typeof missionIntakeSchema>;
