import { z } from "zod";
import { sparseShape } from "@zcode/shared/config-schema";

export const httpProviderApiTypeDataSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
]);
/**
 * Muse Code 本地执行后端：通过本机 `muse serve`（Muse Session Protocol, MSP）
 * 驱动已登录的 Muse Code CLI。不是 HTTP 端点，因此该类型的完整配置不携带
 * baseUrl，也不需要 API Key——凭证由 CLI 自己的登录会话持有。
 */
export const museSessionProtocolApiTypeDataSchema = z.literal("muse-session-protocol");
export const providerApiTypeDataSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
  "muse-session-protocol",
]);
export const providerGroupDataSchema = z.enum([
  "standard-personal",
  "zai-family",
  "bigmodel-family",
]);
export const zhipuAccountModeDataSchema = z.enum([
  "start-plan",
  "individual-coding-plan",
  "team-coding-plan",
  "off-peak",
  // 加速卡访问类别；与 zcodeProviderAccountAccessSchema.mode 同值，改动需同步两处。
  "highspeed",
]);
export const providerVisibilityDataSchema = z.enum(["visible", "hidden"]);
export const providerLogoDataSchema = z
  .object({ type: z.literal("builtin"), key: z.string().min(1) })
  .strict();

const nonBlankRequiredString = z.string().refine((value) => value.trim().length > 0, {
  message: "必填配置不能为空",
  params: { configIssueCode: "required-field-missing" },
});

export const apiKeyAccessDataSchema = z
  .object({
    type: z.enum(["api-key", "zhipu-coding-plan-api-key"]),
    apiKey: z.string().nullable().optional(),
    apiKeyManagementUrl: z.string().url().nullable().optional(),
  })
  .strict();
export const completeApiKeyAccessDataSchema = apiKeyAccessDataSchema.extend({
  apiKey: nonBlankRequiredString,
});

export const completeZhipuAccountAccessDataSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    mode: zhipuAccountModeDataSchema,
    entitled: z.boolean(),
  })
  .strict();
export const zhipuAccountAccessDataSchema = z
  .object({
    ...sparseShape(completeZhipuAccountAccessDataSchema.shape),
    type: completeZhipuAccountAccessDataSchema.shape.type,
  })
  .strict();
/**
 * Muse Code CLI 本地接入：MOS 不保存任何凭证，运行时借用本机已登录的
 * Muse Code CLI 会话（订阅额度）。字段有意保持为空——新增字段需同步
 * MuseLocalAccessConfig 与序列化分支。
 */
export const museLocalAccessDataSchema = z.object({ type: z.literal("muse-cli-local") }).strict();
export const completeMuseLocalAccessDataSchema = museLocalAccessDataSchema;
export const providerAccessDataSchema = z.discriminatedUnion("type", [
  apiKeyAccessDataSchema,
  zhipuAccountAccessDataSchema,
  museLocalAccessDataSchema,
]);
export const completeProviderAccessDataSchema = z.discriminatedUnion("type", [
  completeApiKeyAccessDataSchema,
  completeZhipuAccountAccessDataSchema,
  completeMuseLocalAccessDataSchema,
]);

const completeHttpProviderApiDataSchema = z
  .object({
    type: httpProviderApiTypeDataSchema,
    baseUrl: nonBlankRequiredString.pipe(z.string().url()),
    headers: z.record(z.string(), z.string()).readonly().nullable().optional(),
  })
  .strict();
const completeMuseProviderApiDataSchema = z
  .object({
    type: museSessionProtocolApiTypeDataSchema,
  })
  .strict();
export const completeProviderApiDataSchema = z.discriminatedUnion("type", [
  completeHttpProviderApiDataSchema,
  completeMuseProviderApiDataSchema,
]);
// 稀疏形态保持单一对象：编辑中的 api 允许缺 type/baseUrl（sparseShape 语义不变），
// 完整性由 complete 联合按 type 分支校验（muse 分支拒绝多余字段，fail-closed）。
export const providerApiDataSchema = z
  .object({
    type: providerApiTypeDataSchema.optional(),
    baseUrl: z.string().url().nullable().optional(),
    headers: z.record(z.string(), z.string()).readonly().nullable().optional(),
  })
  .strict();
// Personal 允许暂存编辑中的 endpoint；完整 schema 仍拒绝，且只影响该 Provider 的准入。
export const personalProviderApiDataSchema = providerApiDataSchema.extend({
  baseUrl: z.string().nullable().optional(),
});

const modelIdsDataSchema = z.array(z.string().min(1)).readonly().nullable().optional();
export const providerConfigDataSchema = z
  .object({
    group: providerGroupDataSchema.nullable().optional(),
    logo: providerLogoDataSchema.nullable().optional(),
    access: providerAccessDataSchema.nullable().optional(),
    api: providerApiDataSchema.nullable().optional(),
    builtinModelIds: modelIdsDataSchema,
    personalModelIds: modelIdsDataSchema,
    modelOrder: modelIdsDataSchema,
    visibility: providerVisibilityDataSchema.nullable().optional(),
  })
  .strict();
export const completeProviderConfigDataSchema = providerConfigDataSchema.extend({
  group: providerGroupDataSchema,
  access: completeProviderAccessDataSchema,
  api: completeProviderApiDataSchema,
});

export const providerTemplateNameMapDataSchema = z
  .object({
    "zh-CN": z.string().min(1).optional(),
    "en-US": z.string().min(1).optional(),
  })
  .strict();
export const providerTemplateDataSchema = z
  .object({
    templateId: z.string().min(1),
    templateNameMap: providerTemplateNameMapDataSchema,
    config: providerConfigDataSchema,
  })
  .strict();
