import { z } from "zod";
import { nullableStringSchema, opaqueIdSchema } from "./common.js";

/**
 * TenantContext —— core-contracts-v3.0.yaml §objects.TenantContext。
 * required: [tenant_id, workspace_id, actor_id]；其余字段可空但必须显式 null。
 */
export const tenantContextSchema = z.object({
  tenant_id: opaqueIdSchema,
  workspace_id: opaqueIdSchema,
  actor_id: opaqueIdSchema,
  brand_id: nullableStringSchema,
  source_zcode_session_id: nullableStringSchema,
  source_zcode_task_id: nullableStringSchema,
});
export type TenantContext = z.infer<typeof tenantContextSchema>;
