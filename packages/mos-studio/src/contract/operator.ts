import { z } from "zod";

/**
 * 操作者声明（operator declaration）：面板一次性录入、落 $ZCODE_PLUGIN_DATA。
 * 这是组合根能拿到的诚实 user 事实（插件面没有 ZCode 账户 user id 事实）——
 * 声明即声明（loginProvider 固定标记），绝不冒充 ZCode 账户事实。
 */

export const operatorRecordSchema = z.strictObject({
  userId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(200).nullable().default(null),
  declaredAt: z.string().min(1),
});

export type OperatorRecord = z.infer<typeof operatorRecordSchema>;

export const OPERATOR_LOGIN_PROVIDER = "mos_operator_declaration";

/** ZCodeUserIdentity 形状（@mos/adapters session-port）：由 operator 声明映射。 */
export function operatorAsUserIdentity(operator: OperatorRecord): {
  userId: string;
  organizationId: string | null;
  loginProvider: string;
} {
  return {
    userId: operator.userId,
    organizationId: operator.organizationId,
    loginProvider: OPERATOR_LOGIN_PROVIDER,
  };
}
