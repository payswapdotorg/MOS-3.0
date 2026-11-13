import type { ExperimentLookup } from "../contract/calibration.js";
import {
  CalibrationSourceError,
  type CalibrationIntake,
  type CalibrationWriteDeps,
} from "../contract/calibration.js";
import {
  calibrationRecordSchema,
  parseOrFail,
  type CalibrationRecord,
} from "@mos/contracts";

/**
 * 校准领域纯函数：
 * 1. assertCalibrationSource —— 来源门禁（fail-closed）：实验必须存在、必须
 *    concluded、必须携带测量证据（不变量 §23：校准只引用带证据的收尾实验）；
 *    任何缺口 → CalibrationSourceError（具名 reason），绝不降级为空校准。
 * 2. calibrationFromIntake —— intake → CalibrationRecord（delayed_mode 恒 true；
 *    证据引用 = 实验测量证据 ∪ 调用方附加引用）。
 */

export function assertCalibrationSource(
  lookup: ExperimentLookup,
  tenantId: string,
  experimentRef: string,
): void {
  const experiment = lookup(tenantId, experimentRef);
  if (experiment === undefined) {
    throw new CalibrationSourceError("experiment_not_found", experimentRef);
  }
  if (experiment.status !== "concluded") {
    throw new CalibrationSourceError("not_concluded", experimentRef);
  }
  if (experiment.measurement_evidence_refs.length === 0) {
    throw new CalibrationSourceError("no_measurement_evidence", experimentRef);
  }
}

export function calibrationFromIntake(
  intake: CalibrationIntake,
  deps: CalibrationWriteDeps,
): CalibrationRecord {
  return parseOrFail("CalibrationRecord", calibrationRecordSchema, {
    id: deps.id,
    tenant_id: intake.tenant_id,
    experiment_ref: intake.experiment_ref,
    calibration: intake.calibration,
    recommendation: intake.recommendation,
    delayed_mode: true,
    evidence_refs: intake.evidence_refs,
    created_at: deps.now,
    updated_at: deps.now,
  });
}
