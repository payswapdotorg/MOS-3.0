import { z } from "zod";
import { opaqueIdSchema } from "@mos/contracts";

/**
 * mos-learning 契约 —— 校准记录（CalibrationRecord）的写入口与类型化错误。
 *
 * 决策锁（architecture §12 / 不变量 §23）：
 * - 校准只能源自 **concluded 且带测量证据** 的实验记录（结构化端口注入，本包不
 *   import @mos/experiments）；
 * - delayed-mode 安全位恒为 true（schema 层 z.literal(true)）：本包只产出**建议记录**，
 *   绝不提供任何修改 routes/production/实验的 API——实时自动应用被契约排除。
 */

/** 校准记录写入口（delayed_mode 由服务端强制 true，调用方不可表达 false）。 */
export const calibrationIntakeSchema = z.object({
  tenant_id: opaqueIdSchema,
  experiment_ref: z.string().min(1),
  calibration: z.record(z.string(), z.unknown()),
  recommendation: z.string().nullable(),
  evidence_refs: z.array(z.string().min(1)).default([]),
});
export type CalibrationIntake = z.infer<typeof calibrationIntakeSchema>;

/** 结构化实验查询端口：组合根把 (tenant, experimentRef) 解析到 @mos/experiments 记录。 */
export type ExperimentLookup = (
  tenantId: string,
  experimentRef: string,
) =>
  | {
      status: string;
      outcome: string | null;
      measurement_evidence_refs: readonly string[];
    }
  | undefined;

export class CalibrationSourceError extends Error {
  constructor(
    public readonly reason: "experiment_not_found" | "not_concluded" | "no_measurement_evidence",
    public readonly experimentRef: string,
  ) {
    super(`校准来源不合格（${reason}）: ${experimentRef}`);
    this.name = "CalibrationSourceError";
  }
}

/** 写入依赖（id/now 注入；与 W2/W3 各 store 同约定）。 */
export interface CalibrationWriteDeps {
  readonly id: string;
  readonly now: string;
}
