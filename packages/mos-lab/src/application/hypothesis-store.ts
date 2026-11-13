import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertTenantScope,
  ContractValidationError,
  hypothesisSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Hypothesis } from "@mos/contracts";
import {
  hypothesisProposalSchema,
  MissionNotFoundError,
} from "../contract/hypothesis.js";
import type { HypothesisProposal, MissionLookup } from "../contract/hypothesis.js";
import {
  assertLabHypothesisCarriesNoOutcome,
  hypothesisFromProposal,
} from "../domain/hypothesis.js";
import type { HypothesisProposalDeps } from "../contract.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-hypotheses.json";
const STORE_SCHEMA_VERSION = 1;

export interface HypothesisStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /**
   * Mission 查找端口（结构化注入，无 provider I/O）：任何假设写入都要求
   * mission 存在且属于调用方租户——端口返回 undefined → MissionNotFoundError。
   */
  readonly missionLookup: MissionLookup;
}

/**
 * 持久 tenant-scoped Hypothesis 存储（与 W1 mos-missions mission-store 同模式）。
 *
 * - 文件后端：注入目录下单文件 mos-hypotheses.json；原子写（同目录 tmp + rename）；
 *   文件缺失 → 空启动（durable = 跨进程重启可读）。
 * - 写边界（决策锁 #18——假设记录永不携带实验结果）：
 *   - proposeHypothesis：missionLookup 未命中 → MissionNotFoundError（他租户 mission
 *     与不存在同义）；坏端口返回他租户 mission → assertTenantScope InvariantViolation；
 *     记录由 hypothesisFromProposal 强制 status="proposed"、experiment_ref=null。
 *   - saveHypothesis（全记录写路径，供 superseded/withdrawn 生命周期演化）：
 *     同样要求 mission 存在；经 assertLabHypothesisCarriesNoOutcome——
 *     experiment_ref 任何非 null 值、status=adopted_by_experiment 一律 fail-closed
 *     （实验采纳写入权归 Experiment authority，W3）。
 * - tenant 边界（与 ResearchNoteStore 同约定）：saveHypothesis/proposeHypothesis 遇
 *   tenant 不一致、getHypothesis 命中他租户记录 → InvariantViolation；未命中 → null；
 *   listHypotheses / listHypothesesByMission 只返回调用方租户的记录。
 * - evidence_refs 逐字保存（工作包端口集不含假设的 evidence 校验，见 CONTRACT.md「已知限制」）。
 * - 读取容忍未知键（additive），JSON/结构损坏 fail-closed 抛 ContractValidationError。
 */
export class HypothesisStore {
  private readonly directory: string;
  private readonly missionLookup: MissionLookup;

  constructor(options: HypothesisStoreOptions) {
    this.directory = options.directory;
    this.missionLookup = options.missionLookup;
  }

  /**
   * 提案写入：mission 必须存在（端口未命中 → MissionNotFoundError）；
   * 记录由领域纯函数强制 status="proposed"、experiment_ref=null（决策锁 #18）。
   */
  proposeHypothesis(
    tenantId: string,
    proposal: HypothesisProposal,
    deps: HypothesisProposalDeps,
  ): Hypothesis {
    const normalized = parseOrFail(
      "HypothesisProposal",
      hypothesisProposalSchema,
      proposal,
    ) as HypothesisProposal;

    // mission 必须存在且属同一租户（未命中/跨租户 → MissionNotFoundError/InvariantViolation）。
    this.lookupMission(tenantId, normalized.mission_id);

    const record = hypothesisFromProposal(normalized, { id: deps.id, now: deps.now });
    assertTenantScope(record, { tenant_id: tenantId }, "hypothesis");
    assertLabHypothesisCarriesNoOutcome(record);

    this.persist(record);
    return record;
  }

  /**
   * 全记录写入（upsert，供生命周期演化：superseded / withdrawn）：
   * mission 必须存在；experiment_ref 非 null 或 adopted_by_experiment 一律 fail-closed。
   */
  saveHypothesis(tenantId: string, hypothesis: Hypothesis): Hypothesis {
    const validated = parseOrFail("Hypothesis", hypothesisSchema, hypothesis) as Hypothesis;
    assertTenantScope(validated, { tenant_id: tenantId }, "hypothesis");
    assertLabHypothesisCarriesNoOutcome(validated);
    this.lookupMission(tenantId, validated.mission_id);
    this.persist(validated);
    return validated;
  }

  /**
   * 读取单条 Hypothesis：id 未命中任何记录 → null；
   * 命中他租户记录 → assertTenantScope InvariantViolation（跨租户访问显式拒绝）。
   */
  getHypothesis(tenantId: string, hypothesisId: string): Hypothesis | null {
    const found = this.readAll().find((record) => record.id === hypothesisId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "hypothesis");
    return found;
  }

  /** 列出调用方租户的全部 Hypothesis。 */
  listHypotheses(tenantId: string): readonly Hypothesis[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 列出调用方租户内挂在指定 mission 下的假设。 */
  listHypothesesByMission(
    tenantId: string,
    missionId: string,
  ): readonly Hypothesis[] {
    return this.readAll().filter(
      (record) => record.tenant_id === tenantId && record.mission_id === missionId,
    );
  }

  /** mission 解析：端口未命中 → MissionNotFoundError；坏端口返回他租户记录 → fail-closed。 */
  private lookupMission(tenantId: string, missionId: string) {
    const mission = this.missionLookup(tenantId, missionId);
    if (mission === undefined) {
      throw new MissionNotFoundError(tenantId, missionId);
    }
    assertTenantScope(mission, { tenant_id: tenantId }, "mission");
    return mission;
  }

  /** upsert 持久化（原子写）。 */
  private persist(hypothesis: Hypothesis): void {
    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === hypothesis.tenant_id && record.id === hypothesis.id,
    );
    this.writeAll(
      existing === undefined
        ? [...all, hypothesis]
        : all.map((record) => (record === existing ? hypothesis : record)),
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Hypothesis[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("HypothesisStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("HypothesisStore", [
        "存储文件结构必须是 { version, hypotheses }",
      ]);
    }
    const hypotheses = (parsed as { hypotheses?: unknown }).hypotheses;
    if (!Array.isArray(hypotheses)) {
      throw new ContractValidationError("HypothesisStore", [
        "存储文件缺少 hypotheses 数组",
      ]);
    }
    return hypotheses.map(
      (record) => parseOrFail("Hypothesis", hypothesisSchema, record) as Hypothesis,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(hypotheses: readonly Hypothesis[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, hypotheses }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
