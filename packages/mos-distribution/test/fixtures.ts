import type { DistributionIntent } from "@mos/contracts";
import { intentFromInput } from "../src/index.js";
import type { DistributionIntentInput } from "../src/index.js";

/**
 * 测试夹具：mos-distribution 最小合法事实集（本包不得 import @mos/integrations 等
 * 模块——connection/capability_instance/artifact 全部是不透明引用，逐字构造，
 * 与组合根注入的记录同形）。
 */

export const T1 = "2026-11-13T00:00:00Z";
export const T2 = "2026-11-13T01:00:00Z";
export const T3 = "2026-11-13T02:00:00Z";
export const TENANT = "tenant-acme";
export const OTHER_TENANT = "tenant-globex";
export const STORE_FILE = "mos-distribution-intents.json";

export const CONNECTION_ID = "conn:tenant-acme:linkedin:1";
export const CAPABILITY_INSTANCE_ID = "ci:tenant-acme:content.publish:conn-1";
export const ARTIFACT_REF = "artifact:pricing-page-copy:v3";
export const PREVIEW_REF = "preview:tenant-acme:linkedin:publish:1";
export const PREVIEW_HASH = "sha256:9f2c8b1a4d6e0f3a7b5c9d1e8f2a4b6c";
export const EVIDENCE_REF = "evidence:linkedin-publish-response:1";
export const EVIDENCE_REF_2 = "evidence:linkedin-publish-webhook:1";

export function baseInput(
  overrides: Partial<DistributionIntentInput> = {},
): DistributionIntentInput {
  return {
    tenant_id: TENANT,
    operation: "publish",
    connection_id: CONNECTION_ID,
    capability_instance_id: CAPABILITY_INSTANCE_ID,
    artifact_ref: ARTIFACT_REF,
    artifact_version: 3,
    target: { channel: "linkedin", visibility: "public" },
    idempotency_key: null,
    ...overrides,
  };
}

/** 从合法输入构造 status=intent 的起点记录（经 domain intentFromInput，与 store 创建同形）。 */
export function baseIntent(
  overrides: Partial<DistributionIntent> = {},
  inputOverrides: Partial<DistributionIntentInput> = {},
): DistributionIntent {
  return {
    ...intentFromInput(baseInput(inputOverrides), { now: T1, id: "intent-1" }),
    ...overrides,
  };
}

/** 手工构造的完整记录（domain 层防御测试用：模拟损坏/旁路记录，不经任何写路径）。 */
export function handBuiltIntent(
  overrides: Partial<DistributionIntent> = {},
): DistributionIntent {
  return {
    id: "intent-handbuilt",
    tenant_id: TENANT,
    operation: "publish",
    connection_id: CONNECTION_ID,
    capability_instance_id: CAPABILITY_INSTANCE_ID,
    artifact_ref: ARTIFACT_REF,
    artifact_version: 3,
    target: { channel: "linkedin", visibility: "public" },
    preview_ref: null,
    preview_hash: null,
    approval_state: "pending",
    idempotency_key: null,
    status: "intent",
    execution_records: [],
    created_at: T1,
    updated_at: T1,
    ...overrides,
  };
}
