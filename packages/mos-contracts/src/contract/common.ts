import { z } from "zod";

/**
 * core-contracts-v3.0.yaml §conventions 的公共原语。
 * - ids: opaque-stable-ids（非空字符串，不承诺格式）
 * - timestamps: RFC3339-UTC
 * - monetary_values: decimal-string-with-currency
 * - unknown_values: null-plus-explicit-status; never guessed
 */

/** RFC3339 UTC 时间戳（z 默认 ISO 校验拒绝带本地时区偏移的写法）。 */
export const rfc3339TimestampSchema = z
  .string()
  .refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value), {
    message: "timestamp 必须是 RFC3339 UTC（以 Z 结尾）",
  });
export type Rfc3339Timestamp = z.infer<typeof rfc3339TimestampSchema>;

/** 不透明稳定 id。契约不承诺内部格式，调用方不得解析其结构。 */
export const opaqueIdSchema = z.string().min(1);
export type OpaqueId = z.infer<typeof opaqueIdSchema>;

/** 不透明引用（credential_ref、content_ref 等）。只允许指向既有存储键，不允许内联值。 */
export const opaqueRefSchema = z
  .string()
  .min(1)
  .refine((value) => !/^(sk-|Bearer\s|eyJ|ghp_)/i.test(value), {
    message: "opaque-reference 疑似内联了凭据或令牌值",
  });
export type OpaqueRef = z.infer<typeof opaqueRefSchema>;

/** 金额：decimal-string-with-currency，避免浮点误差进入持久层。 */
export const moneySchema = z.object({
  amount: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, "amount 必须是十进制字符串"),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "currency 必须是 ISO 4217 三字母码"),
});
export type Money = z.infer<typeof moneySchema>;

/** 可空字符串：显式 unknown 约定（null 表示"未提供/未知"，绝不猜值）。 */
export const nullableStringSchema = z.string().nullable();

/** 外部事实来源：source-and-observed-at-required-for-external-facts。 */
export const provenanceSourceSchema = z.object({
  url: z.string().min(1).nullable(),
  observed_at: rfc3339TimestampSchema,
  note: z.string().nullable().optional(),
});
export type ProvenanceSource = z.infer<typeof provenanceSourceSchema>;

/** 版本号契约：整数、从 1 开始，破坏性变更必须 bump 版本。 */
export const contractVersionSchema = z.number().int().min(1);
export type ContractVersion = z.infer<typeof contractVersionSchema>;
