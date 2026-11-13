// release-smoke 证据记录器：步骤（step）状态 + 证据 JSON 落盘。
// 两套冒烟脚本（inspect-package / run-platform-smoke）共用同一套语义：
//   passed   —— 全部断言通过；
//   degraded —— 降级完成（环境缺工具等），真实结论需人工/后续 runner 补齐；
//   skipped  —— 按契约显式跳过（如同版本 RC 无升级对），绝不伪造通过；
//   failed   —— 任一断言失败；一旦 failed 不再翻回其它状态（failure 粘滞）。
// 任何步骤抛异常都按 failed 记录，绝不让证据半途丢失。
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const STEP_STATUSES = ["passed", "failed", "skipped", "degraded"];

const MAX_DETAIL_DEPTH = 6;

/** 合并 detail：字符串与对象共存，便于 evidence 里既有人读的摘要也有机器读的字段。 */
function mergeDetail(current, next) {
  if (next === undefined || next === null) return current;
  if (typeof next === "string") {
    return typeof current === "string" ? `${current}\n${next}` : { message: next, ...(isPlainObject(current) ? current : {}) };
  }
  if (isPlainObject(next)) {
    const base = isPlainObject(current) ? current : typeof current === "string" ? { message: current } : {};
    return { ...base, ...next };
  }
  return { ...((isPlainObject(current) && current) || {}), value: String(next) };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 裁剪证据体量：detail 深度与数组长度封顶，防止把巨型日志写进 evidence。 */
function clampDetail(value, depth = 0) {
  if (depth >= MAX_DETAIL_DEPTH) return "[clamped]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => clampDetail(item, depth + 1));
  if (isPlainObject(value)) {
    const clamped = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      clamped[key] = clampDetail(item, depth + 1);
    }
    return clamped;
  }
  if (typeof value === "string" && value.length > 8000) {
    return `${value.slice(0, 8000)}\n[clamped ${value.length - 8000} chars]`;
  }
  return value;
}

/**
 * 创建证据记录器。
 * @param {object} input
 * @param {string} input.schema 证据 schema 字符串（如 mos-release-smoke/run-platform-smoke@1）。
 * @param {Record<string, unknown>} [input.meta] 顶层元数据（platform/mosVersion/workdir 等）。
 */
export function createEvidenceRecorder({ schema, meta = {} }) {
  /** @type {Array<{name: string, status: string, detail: unknown, durationMs: number}>} */
  const steps = [];
  /** @type {Array<{step: string, detail: unknown}>} */
  const failures = [];

  const recorder = {
    get steps() {
      return steps.map((step) => ({ ...step }));
    },
    get failures() {
      return failures.map((failure) => ({ ...failure }));
    },
    get ok() {
      return failures.length === 0;
    },
    /**
     * 运行一个具名步骤。run 收到 stepApi；任何抛错都折算为 failed。
     * @param {string} name
     * @param {(step: import("./evidence-types.mjs").StepApi) => void | Promise<void>} run
     */
    async step(name, run) {
      const record = { name, status: "passed", detail: null, durationMs: 0 };
      steps.push(record);
      const startedAt = Date.now();
      const stepApi = {
        note(detail) {
          record.detail = mergeDetail(record.detail, detail);
        },
        passed(detail) {
          if (record.status !== "failed") record.status = "passed";
          if (detail !== undefined) stepApi.note(detail);
        },
        failed(detail) {
          record.status = "failed";
          if (detail !== undefined) stepApi.note(detail);
          failures.push({ step: name, detail: record.detail });
        },
        skipped(detail) {
          if (record.status !== "failed") record.status = "skipped";
          if (detail !== undefined) stepApi.note(detail);
        },
        degraded(detail) {
          if (record.status !== "failed") record.status = "degraded";
          if (detail !== undefined) stepApi.note(detail);
        },
      };
      try {
        await run(stepApi);
      } catch (error) {
        stepApi.failed({
          thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
      record.durationMs = Date.now() - startedAt;
      return { ...record };
    },
    toJSON() {
      return {
        schema,
        ...meta,
        generatedAt: new Date().toISOString(),
        steps: steps.map((step) => ({
          name: step.name,
          status: step.status,
          detail: clampDetail(step.detail),
          durationMs: step.durationMs,
        })),
        ok: recorder.ok,
        failures: failures.map((failure) => ({ step: failure.step, detail: clampDetail(failure.detail) })),
      };
    },
    /** 原子写证据 JSON（tmp + rename），失败时退化为直写，绝不静默丢证据。 */
    async write(filePath) {
      const payload = `${JSON.stringify(recorder.toJSON(), null, 2)}\n`;
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp-${process.pid}`;
      try {
        await writeFile(tmpPath, payload, "utf8");
        await rename(tmpPath, filePath);
      } catch {
        await writeFile(filePath, payload, "utf8");
      }
      return filePath;
    },
  };

  return recorder;
}
