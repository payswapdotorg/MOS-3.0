import { randomUUID } from "node:crypto";
import type { SessionFactsPort, TaskCreatedEvent } from "@mos/adapters";
import type { TimePort } from "@mos/adapters";
import { IdentityBridgeService } from "@mos/identity-bridge";
import type {
  MissionIntake,
  MissionSidecarFailure,
  MissionSidecarStage,
} from "../contract.js";
import { missionFromIntake } from "../domain/intake.js";
import { MissionStore } from "./mission-store.js";
import { describeError } from "./support.js";

export interface MissionSidecarDeps {
  /** ZCode 会话事实端口（只读；observeTaskCreated 缺席时 sidecar 缺席）。 */
  readonly sessionFacts: SessionFactsPort;
  /** tenant 边界解析（mos-identity-bridge）。 */
  readonly identityBridge: IdentityBridgeService;
  /** tenant-scoped 持久存储。 */
  readonly store: MissionStore;
  /** 时间端口（created_at/updated_at/事件 occurred_at 一律经此获得）。 */
  readonly time: TimePort;
}

/** 附加句柄：dispose 后不再处理任何任务创建事实。 */
export interface MissionSidecarAttachment {
  dispose(): void;
}

/**
 * Mission sidecar 关联服务（graceful failure，FINAL-TL-HANDOFF-WEEK-1.md §A：
 * "If MOS parsing or sidecar persistence fails, the normal ZCode task must
 * still be created and function normally"）。
 *
 * - 只订阅"标准任务创建成功"事实（SessionFactsPort.observeTaskCreated），
 *   绝不参与、阻塞或改写标准任务路径；
 * - tenant 不可解析 → 静默缺席（fail-closed：不记录任何 mission、绝不外抛），
 *   原因留在 lastErrors 供诊断（graceful failure 只内部记录）；
 * - objective_verbatim 只用事件事实："[mos] Mission sidecar for task <taskId>"
 *   （真实目标由 W1 组合层从任务提示语后续填充；绝不编造营销内容）；
 * - intake 直接携带事件事实的 source_zcode_session_id/source_zcode_task_id
 *   （可空关联：只存引用，ZCode 会话仍是会话/任务状态的唯一权威）；
 * - 幂等：(tenant, source_zcode_session_id) 已有 mission → 绝不重复；
 * - 一切异常都收集进 lastErrors，绝不向上抛出（监听器是同步 void 回调）。
 */
export class MissionSidecarService {
  private readonly failures: MissionSidecarFailure[] = [];

  /** 附加到会话事实端口；返回 dispose 句柄（端口不支持观察时返回空句柄）。 */
  attachToSessionFacts(deps: MissionSidecarDeps): MissionSidecarAttachment {
    const observe = deps.sessionFacts.observeTaskCreated?.bind(deps.sessionFacts);
    if (!observe) {
      // 端口不提供任务创建观察 → sidecar 缺席（fail-closed），任务路径不受影响。
      return { dispose: () => undefined };
    }
    const unsubscribe = observe((event) => {
      void this.handleTaskCreated(deps, event);
    });
    return { dispose: unsubscribe };
  }

  /** graceful-failure 观测口：已收集的最近失败（复制返回，绝不抛错）。 */
  lastErrors(): readonly MissionSidecarFailure[] {
    return [...this.failures];
  }

  private async handleTaskCreated(
    deps: MissionSidecarDeps,
    event: TaskCreatedEvent,
  ): Promise<void> {
    let stage: MissionSidecarStage = "resolve_tenant";
    try {
      const resolution = await deps.identityBridge.resolveTenantContext();
      if (resolution.status === "unavailable") {
        // tenant 不可解析：fail-closed 静默缺席（不记录任何 mission、绝不外抛）；
        // 原因留在 lastErrors 供诊断（不抛入 ZCode 任务路径）。
        this.failures.push({
          stage,
          message: `tenant unavailable: ${resolution.reason}`,
        });
        return;
      }
      const tenant = resolution.tenantContext;

      stage = "find_existing_mission";
      const existing = deps.store.listMissions(tenant.tenant_id, {
        source_zcode_session_id: event.sessionId,
      });
      if (existing.length > 0) {
        // 幂等：该 (tenant, session) 已有 mission → 不重复创建。
        return;
      }

      stage = "persist_mission";
      const intake: MissionIntake = {
        tenant_id: tenant.tenant_id,
        workspace_id: tenant.workspace_id,
        // 逐字标记（事件事实），不含任何发明的营销内容。
        objective_verbatim: `[mos] Mission sidecar for task ${event.taskId}`,
        // 可空关联直接随 intake 携带（只存引用；ZCode 会话仍是唯一权威）。
        source_zcode_session_id: event.sessionId,
        source_zcode_task_id: event.taskId,
        target_audience: null,
        geography: null,
        desired_outcomes: [],
        success_metrics: [],
        budget: null,
        deadline: null,
      };
      const mission = missionFromIntake(intake, {
        now: deps.time.now(),
        id: `mos-mission-${randomUUID()}`,
      });
      const saved = deps.store.saveMission(tenant.tenant_id, mission);

      stage = "link_session";
      // 显式可空关联步骤（同值幂等，不写不发事件）：保证 ZCode 会话/任务引用存在。
      deps.store.linkSession(tenant.tenant_id, saved.id, {
        sessionId: event.sessionId,
        taskId: event.taskId,
      });
    } catch (error) {
      this.failures.push({ stage, message: describeError(error) });
    }
  }
}
