import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertGigHumanAssignmentJustified,
  assertTenantScope,
  ContractValidationError,
  gigSchema,
  parseOrFail,
} from "@mos/contracts";
import type { Gig, GigStatus } from "@mos/contracts";
import { gigIntakeSchema } from "../contract/gig.js";
import {
  GigNotFoundError,
  GigValidationError,
} from "../contract/gig.js";
import type { GigCreationDeps, GigIntake, GigTransitionDeps } from "../contract/gig.js";
import {
  applyGigTransition,
  assignGig,
  gigFromInput,
  materializeAssignment,
  publishGig,
} from "../domain/gig-transitions.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-gigs.json";
const STORE_SCHEMA_VERSION = 1;

export interface GigStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped Gig 存储（与 W2/W3 各 store 同模式）。
 * - 文件后端、原子写（同目录 tmp + rename）、fail-closed 读取（损坏即拒读）。
 * - 发布（§8 包完整性）/ 指派（§23 人工指派路线比较）门禁在领域层，落盘前再跑终守卫。
 * - 租户边界：跨租户读/写一律 InvariantViolation（绝不静默降级）。
 */
export class GigStore {
  private readonly directory: string;

  constructor(options: GigStoreOptions) {
    this.directory = options.directory;
  }

  createGig(tenantId: string, input: GigIntake, deps: GigCreationDeps): Gig {
    let normalized: GigIntake;
    try {
      normalized = parseOrFail("GigIntake", gigIntakeSchema, input) as GigIntake;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new GigValidationError(error.issues);
      }
      throw error;
    }
    const record = gigFromInput(normalized, deps);
    assertTenantScope(record, { tenant_id: tenantId }, "gig");
    const all = this.readAll();
    this.persist(all, record);
    return record;
  }

  getGig(tenantId: string, gigId: string): Gig | null {
    const found = this.readAll().find((record) => record.id === gigId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "gig");
    return found;
  }

  /** 列出调用方租户的全部 gig（其他租户的记录不可见）。 */
  listGigsByTenant(tenantId: string): readonly Gig[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** draft → published（§8 包完整性门禁；缺披露 → GigPublishBlockedError）。 */
  publishGig(tenantId: string, gigId: string, deps: GigTransitionDeps): Gig {
    const all = this.readAll();
    const current = this.findGig(all, tenantId, gigId);
    const next = publishGig(current, deps);
    this.persist(all, next);
    return next;
  }

  /** published → assigned（human 指派过 §23 门禁；类型化阻断错误）。 */
  assignGig(
    tenantId: string,
    gigId: string,
    assignment: {
      assigned_node_ref: { kind: string; id: string };
      route_comparison?: unknown;
    },
    deps: GigTransitionDeps,
  ): Gig {
    const all = this.readAll();
    const current = this.findGig(all, tenantId, gigId);
    const materialized = materializeAssignment(assignment);
    const next = assignGig(current, materialized, deps);
    this.persist(all, next);
    return next;
  }

  /** 通用合法转移（in_progress / delivered / accepted / rejected / cancelled）。 */
  applyTransition(
    tenantId: string,
    gigId: string,
    target: GigStatus,
    deps: GigTransitionDeps,
  ): Gig {
    const all = this.readAll();
    const current = this.findGig(all, tenantId, gigId);
    const next = applyGigTransition(current, target, deps);
    this.persist(all, next);
    return next;
  }

  private findGig(all: readonly Gig[], tenantId: string, gigId: string): Gig {
    const found = all.find((record) => record.id === gigId);
    if (found === undefined) {
      throw new GigNotFoundError(tenantId, gigId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "gig");
    return found;
  }

  /** 落盘前统一守卫：schema + 不变量 §23（每条持久记录都过，defense in depth）。 */
  private persist(all: readonly Gig[], record: Gig): void {
    const validated = parseOrFail("Gig", gigSchema, record) as Gig;
    assertGigHumanAssignmentJustified(validated);
    const existing = all.find(
      (candidate) =>
        candidate.tenant_id === validated.tenant_id && candidate.id === validated.id,
    );
    this.writeAll(
      existing === undefined
        ? [...all, validated]
        : all.map((candidate) => (candidate === existing ? validated : candidate)),
    );
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly Gig[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("GigStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("GigStore", [
        "存储文件结构必须是 { version, gigs }",
      ]);
    }
    const gigs = (parsed as { gigs?: unknown }).gigs;
    if (!Array.isArray(gigs)) {
      throw new ContractValidationError("GigStore", ["存储文件缺少 gigs 数组"]);
    }
    return gigs.map((record) => parseOrFail("Gig", gigSchema, record) as Gig);
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(gigs: readonly Gig[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, gigs }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
