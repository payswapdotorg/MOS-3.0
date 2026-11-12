import { z } from "zod";
import type { ZodType } from "zod";

/**
 * 写边界统一校验：契约解析失败必须抛错（fail-closed），绝不静默丢字段。
 * 读边界按 zod 默认策略容忍未知键（additive 演化）。
 */

export class ContractValidationError extends Error {
  constructor(
    public readonly contract: string,
    public readonly issues: string[],
  ) {
    super(`契约校验失败 [${contract}]: ${issues.join("; ")}`);
    this.name = "ContractValidationError";
  }
}

export function parseOrFail<Schema extends ZodType>(
  contract: string,
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContractValidationError(
      contract,
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}
