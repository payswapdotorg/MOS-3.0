import { isMuseDelegatedModelSelection, type MuseCodeBackendSettings } from "@zcode/shared";
import { readMuseCodeBackendSettings } from "../muse-code/muse-code-settings.js";
// MC-D（评审 pivot 2026-11-15）：按会话模型选型路由委托 Muse Code 后端。
//
// 语义（与 renderer 侧 commandFactory 的信封携带条件同规则，见 shared
// isMuseDelegatedModelSelection）：
// - 用户意图：Host 设置 useAsTaskBackend（与执行端口/服务同一设置文件——
//   `~/.zcode/v2/muse-code-backend.json`，宽容读，缺省 false = 零行为变化）。
// - 选型意图：本轮有效模型选型（payload.modelSelection ?? 会话常驻选型，
//   resolveSubmittedExecutionState 已归一）命中 Muse delegated 模型家族
//   （muse-spark-<version>-contributor；OpenCode Zen `-free` 免费变体不属于家族）。
// - 两层意图同时成立 → 该轮按 executionBackend: "muse-code" 执行（信封显式
//   字段仍优先/等价——renderer 携带时同一路由）。
//
// 覆盖面：CLI 侧路由让**任何**提交面受益——New Task Composer、Studio 关联会话、
// 冷恢复后的续发——只要有效选型命中家族；renderer 信封字段保持显式线上意图。
// busy/queue/guide/choice 等委托轮不可排队/抢占的准入约束不变（session-flow
// 的 fail-closed 拒绝共用同一路由判定）。

/**
 * 按模型选型路由委托后端（MC-D）。settings 可注入供测试；缺省读 Host 持久化的
 * 同一设置文件（宽容读，失败按缺省 false 处理——fail-closed，绝不因设置读
 * 失败而静默改道）。
 */
export async function shouldRouteMuseDelegatedBySelection(input: {
  selection: { providerId?: string; modelId?: string } | undefined | null;
  env?: NodeJS.ProcessEnv;
  settings?: MuseCodeBackendSettings;
}): Promise<boolean> {
  if (!isMuseDelegatedModelSelection(input.selection)) return false;
  const settings =
    input.settings ?? (await readMuseCodeBackendSettings(input.env ?? process.env));
  return settings.useAsTaskBackend === true;
}
