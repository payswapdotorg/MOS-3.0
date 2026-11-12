import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SystemTimePort } from "@mos/adapters";
import type { TimePort } from "@mos/adapters";
import {
  assertNoInferredMissionFields,
  ContractValidationError,
  domainEventSchema,
  missionSchema,
  parseOrFail,
} from "@mos/contracts";
import type { DomainEvent, Mission } from "@mos/contracts";
import {
  MISSION_AGGREGATE_TYPE,
  MISSION_EVENT_CREATED,
  MISSION_EVENT_LINKED,
} from "../contract/mission-vocabulary.js";
import type { MissionEventType } from "../contract/mission-vocabulary.js";
import type {
  MissionEventSink,
  MissionListFilter,
  MissionLinkInput,
} from "../contract.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-missions.json";
const STORE_SCHEMA_VERSION = 1;

export interface MissionStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 事件时间源；缺省为系统时钟（SystemTimePort）。 */
  readonly time?: TimePort;
  /** append-only 事件监听；缺省不发射任何事件。 */
  readonly eventSink?: MissionEventSink;
  /** 事件 id 工厂；缺省 randomUUID（测试可注入确定 id）。 */
  readonly newEventId?: () => string;
}

/**
 * 持久 tenant-scoped Mission 存储。
 *
 * - 文件后端：目录注入，单文件 mos-missions.json；原子写（先写 tmp 再 rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）。
 * - 读写边界：所有方法都以调用方传入的 tenant_id 为准，其他 tenant 的记录不可见；
 *   saveMission 遇到 mission.tenant_id 与调用方不一致时 fail-closed 抛错。
 * - 校验：写入前 missionSchema + assertNoInferredMissionFields；
 *   读取按 zod 默认策略容忍未知键（additive 演化），结构损坏 fail-closed 抛错。
 * - 事件：首次保存发射 mission.created，关联变更发射 mission.linked，
 *   事件先经 domainEventSchema 校验再交注入监听（append-only 语义由监听方承担）。
 */
export class MissionStore {
  private readonly directory: string;
  private readonly time: TimePort;
  private readonly eventSink?: MissionEventSink;
  private readonly newEventId: () => string;

  constructor(options: MissionStoreOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimePort();
    this.eventSink = options.eventSink;
    this.newEventId = options.newEventId ?? (() => randomUUID());
  }

  /** 保存（upsert）一条 Mission；首次保存发射 mission.created。 */
  saveMission(tenantId: string, mission: Mission): Mission {
    const validated = parseOrFail("Mission", missionSchema, mission) as Mission;
    if (validated.tenant_id !== tenantId) {
      throw new ContractValidationError("Mission", [
        `tenant 越界: mission.tenant_id=${validated.tenant_id} 与调用方 tenant=${tenantId} 不一致`,
      ]);
    }
    assertNoInferredMissionFields(validated);

    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === tenantId && record.id === validated.id,
    );

    if (!existing) {
      this.writeAll([...all, validated]);
      this.emitEvent(MISSION_EVENT_CREATED, validated, {
        mission_id: validated.id,
        status: validated.status,
        source_zcode_session_id: validated.source_zcode_session_id,
        source_zcode_task_id: validated.source_zcode_task_id,
      });
      return validated;
    }

    this.writeAll(
      all.map((record) => (record === existing ? validated : record)),
    );
    return validated;
  }

  /** 读取单条 Mission；不存在或跨 tenant 时返回 null（fail-closed，不抛错）。 */
  getMission(tenantId: string, missionId: string): Mission | null {
    const found = this.readAll().find(
      (record) => record.tenant_id === tenantId && record.id === missionId,
    );
    return found ?? null;
  }

  /** 列出 tenant 的全部 Mission；可按 ZCode 会话引用精确过滤。 */
  listMissions(
    tenantId: string,
    filter?: MissionListFilter,
  ): readonly Mission[] {
    const missions = this.readAll().filter(
      (record) => record.tenant_id === tenantId,
    );
    if (!filter || filter.source_zcode_session_id === undefined) {
      return missions;
    }
    const sessionId = filter.source_zcode_session_id;
    return missions.filter(
      (record) => record.source_zcode_session_id === sessionId,
    );
  }

  /**
   * 设置可空 ZCode 会话/任务关联（preservation contract：只存引用，会话权威仍在 ZCode）。
   * 关联真实变化时更新 updated_at 并发射 mission.linked；无变化则幂等直返（无写入、无事件）。
   */
  linkSession(
    tenantId: string,
    missionId: string,
    link: MissionLinkInput,
  ): Mission | null {
    const all = this.readAll();
    const current = all.find(
      (record) => record.tenant_id === tenantId && record.id === missionId,
    );
    if (!current) return null;

    if (
      current.source_zcode_session_id === link.sessionId &&
      current.source_zcode_task_id === link.taskId
    ) {
      return current;
    }

    const updated = parseOrFail("Mission", missionSchema, {
      ...current,
      source_zcode_session_id: link.sessionId,
      source_zcode_task_id: link.taskId,
      updated_at: this.time.now(),
    }) as Mission;
    assertNoInferredMissionFields(updated);

    this.writeAll(all.map((record) => (record === current ? updated : record)));
    this.emitEvent(MISSION_EVENT_LINKED, updated, {
      mission_id: updated.id,
      source_zcode_session_id: updated.source_zcode_session_id,
      source_zcode_task_id: updated.source_zcode_task_id,
    });
    return updated;
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Mission[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("MissionStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("MissionStore", [
        "存储文件结构必须是 { version, missions }",
      ]);
    }
    const missions = (parsed as { missions?: unknown }).missions;
    if (!Array.isArray(missions)) {
      throw new ContractValidationError("MissionStore", [
        "存储文件缺少 missions 数组",
      ]);
    }
    return missions.map(
      (record) => parseOrFail("Mission", missionSchema, record) as Mission,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(missions: readonly Mission[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, missions }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }

  private emitEvent(
    eventType: MissionEventType,
    mission: Mission,
    payload: Record<string, unknown>,
  ): void {
    if (!this.eventSink) return;
    const event = parseOrFail("DomainEvent", domainEventSchema, {
      id: this.newEventId(),
      tenant_id: mission.tenant_id,
      aggregate_type: MISSION_AGGREGATE_TYPE,
      aggregate_id: mission.id,
      aggregate_version: mission.version,
      event_type: eventType,
      occurred_at: this.time.now(),
      actor: { origin: "mos-missions" },
      correlation_id: mission.id,
      causation_id: null,
      payload,
    }) as DomainEvent;
    this.eventSink(event);
  }
}
