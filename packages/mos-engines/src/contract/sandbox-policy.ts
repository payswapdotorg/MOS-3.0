import { z } from "zod";
import { ContractValidationError, parseOrFail } from "@mos/contracts";

/**
 * 沙箱策略描述符契约（DESCRIPTOR ONLY，决策锁 #9）。
 *
 * - 本文件只描述“一次沙箱化调用【被允许】做什么”，绝不含任何调用/执行代码：
 *   实际的执行适配器是组合根的职责（W3 阶段 deferred）；
 *   本包（mos-engines）只有注册表 + 描述符，没有任何 invocation 路径。
 * - fail-closed：未知 filesystem_scope、缺失字段、非布尔 network_egress、
 *   非正整数 timeout_ms 一律拒绝，绝不猜测默认值（未知保持未知，但拒绝落库）。
 */

/** 沙箱文件系统可见范围的封闭词表（"unknown" = 显式未知，不是“放行”）。 */
export const SANDBOX_FILESYSTEM_SCOPES = ["workspace", "none", "unknown"] as const;
export const sandboxFilesystemScopeSchema = z.enum(SANDBOX_FILESYSTEM_SCOPES);
export type SandboxFilesystemScope = z.infer<typeof sandboxFilesystemScopeSchema>;

/**
 * 沙箱策略描述符：network_egress（是否允许网络出口）、filesystem_scope（文件系统可见
 * 范围）、timeout_ms（超时上限，null = 未指定）。全部字段显式必填——缺键即校验失败
 * （读/写边界都绝不静默补全）；未知键按 zod 默认策略剥离（返回的描述符是规范化形状）。
 */
export const sandboxPolicySchema = z.object({
  network_egress: z.boolean(),
  filesystem_scope: sandboxFilesystemScopeSchema,
  timeout_ms: z.number().int().positive().nullable(),
});
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;

/** 沙箱策略校验失败（fail-closed；ContractValidationError 的类型化投影）。 */
export class SandboxPolicyValidationError extends ContractValidationError {
  constructor(issues: readonly string[]) {
    super("SandboxPolicy", [...issues]);
    this.name = "SandboxPolicyValidationError";
  }
}

/**
 * 沙箱策略 fail-closed 校验：未知 scope 值 / 缺失字段 / 形状不符一律拒绝
 * （抛 SandboxPolicyValidationError），成功返回规范化描述符（剥离未知键）。
 */
export function validateSandboxPolicy(policy: unknown): SandboxPolicy {
  try {
    return parseOrFail("SandboxPolicy", sandboxPolicySchema, policy) as SandboxPolicy;
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new SandboxPolicyValidationError(error.issues);
    }
    throw error;
  }
}
