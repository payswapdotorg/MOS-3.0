import { z } from "zod";
import { authMethodSchema, connectionStatusSchema } from "./enums.js";
import { nullableStringSchema, opaqueIdSchema, opaqueRefSchema, rfc3339TimestampSchema } from "./common.js";

/**
 * ProviderConnection —— core-contracts-v3.0.yaml §objects.ProviderConnection。
 * required: [id, tenant_id, provider_id, auth_method, credential_ref, status]。
 * 密钥永不落库：credential_ref 只是指向 ZCode 凭据存储的不透明引用。
 */
export const providerConnectionSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  provider_id: opaqueIdSchema,
  provider_account_id: nullableStringSchema,
  auth_method: authMethodSchema,
  credential_ref: opaqueRefSchema,
  granted_scopes: z.array(z.string()),
  account_type: nullableStringSchema,
  app_review_status: nullableStringSchema,
  status: connectionStatusSchema,
  last_verified_at: rfc3339TimestampSchema.nullable(),
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

/** 连接存储端口的最小写形状（新增/更新连接时允许的全部字段）。 */
export const providerConnectionUpsertSchema = z.object({
  id: opaqueIdSchema,
  tenant_id: opaqueIdSchema,
  provider_id: opaqueIdSchema,
  provider_account_id: nullableStringSchema.default(null),
  auth_method: authMethodSchema,
  credential_ref: opaqueRefSchema,
  granted_scopes: z.array(z.string()).default([]),
  account_type: nullableStringSchema.default(null),
  app_review_status: nullableStringSchema.default(null),
  status: connectionStatusSchema,
  last_verified_at: rfc3339TimestampSchema.nullable().default(null),
});
export type ProviderConnectionUpsert = z.infer<typeof providerConnectionUpsertSchema>;
