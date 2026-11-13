import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertNodeOfferPublishable,
  assertTenantScope,
  ContractValidationError,
  nodeOfferSchema,
  parseOrFail,
} from "@mos/contracts";
import type { NodeOffer } from "@mos/contracts";
import {
  NodeOfferNotFoundError,
  OfferPublishBlockedError,
  nodeOfferRecordSchema,
  offerPublishInputSchema,
  NODE_OFFER_STATUS_PUBLISHED,
  NODE_OFFER_STATUS_WITHDRAWN,
} from "../contract/node-offer.js";
import type { NodeOfferRecord, OfferPublishInput } from "../contract/node-offer.js";
import { missingOfferDisclosures } from "../domain/offer-gate.js";
import { applyOfferPublishPatch } from "../domain/offer-patch.js";
import type { TimeSource } from "../contract.js";
import { SystemTimeSource } from "./system-time.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-node-offers.json";
const STORE_SCHEMA_VERSION = 1;

export interface NodeOfferStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
  /** 时钟（publish/withdraw 推进 updated_at 用）；缺省为 SystemTimeSource。 */
  readonly time?: TimeSource;
}

/**
 * 持久 tenant-scoped NodeOffer 存储（architecture §8 服务要约）。
 *
 * - 文件后端：单文件 mos-node-offers.json；原子写（同目录 tmp + rename）；文件缺失 → 空启动。
 * - 记录形状：nodeOfferRecordSchema（nodeOfferSchema 超集，draft 阶段 §8 字段可保持 null）；
 *   status=published 的记录必须完整符合 nodeOfferSchema 契约——写边界与 published 读取双重强制。
 * - 发布门禁（fail-closed，无静默默认）：publish 先算缺失披露清单（domain/offer-gate），
 *   非空 → OfferPublishBlockedError（携带缺失字段名）；可发布 → 以 nodeOfferSchema 物化
 *   published 记录（status=published + updated_at），再调 assertNodeOfferPublishable 最终守卫。
 * - 反旁路：save 直接写入 status=published 的记录同样过门禁 + 最终守卫，
 *   披露不全绝不可能经任何写路径变成 published。
 * - tenant 隔离：所有方法以调用方传入的 tenant_id 为准；save/get/publish/withdraw
 *   都过 assertTenantScope（跨租户 fail-closed 抛 InvariantViolation）；get/publish/withdraw
 *   对不存在的 id 抛 NodeOfferNotFoundError。
 * - listPublishedByCapability 只返回该 tenant 的 status=published 且 capability_id 匹配的
 *   记录（draft / withdrawn / expired 绝不作为可用要约出现），且读取时再次过
 *   nodeOfferSchema（损坏的 published 记录 fail-closed，绝不表面化）。
 * - withdraw 幂等：已 withdrawn 的记录不再写入、不改时间戳。
 * - 不存任何密钥/凭据：记录只含不透明引用与描述性字段。
 */
export class NodeOfferStore {
  private readonly directory: string;
  private readonly time: TimeSource;

  constructor(options: NodeOfferStoreOptions) {
    this.directory = options.directory;
    this.time = options.time ?? new SystemTimeSource();
  }

  /**
   * 保存（upsert）一条 offer 记录；同 (tenant, id) 原位替换。
   * status=published 的记录必须完整披露 §8（门禁 + 最终守卫），否则 fail-closed。
   */
  save(tenantId: string, offer: NodeOfferRecord): NodeOfferRecord {
    const validated = parseOrFail(
      "NodeOfferRecord",
      nodeOfferRecordSchema,
      offer,
    ) as NodeOfferRecord;
    assertTenantScope(validated, { tenant_id: tenantId }, "NodeOffer");

    // 写边界反旁路：直写 published 记录同样先过 §8 门禁（类型化缺失名单），
    // 再过 nodeOfferSchema 物化 + assertNodeOfferPublishable 最终守卫。
    if (validated.status === NODE_OFFER_STATUS_PUBLISHED) {
      const missing = missingOfferDisclosures(validated);
      if (missing.length > 0) {
        throw new OfferPublishBlockedError(missing);
      }
    }

    const persisted =
      validated.status === NODE_OFFER_STATUS_PUBLISHED
        ? this.toPublished(validated, validated.updated_at)
        : validated;

    const all = this.readAll();
    const existing = all.find(
      (record) => record.tenant_id === tenantId && record.id === validated.id,
    );

    if (!existing) {
      this.writeAll([...all, persisted]);
      return persisted;
    }

    this.writeAll(all.map((record) => (record === existing ? persisted : record)));
    return persisted;
  }

  /** 读取单条 offer 记录；id 不存在抛 NodeOfferNotFoundError，跨租户读取 fail-closed。 */
  get(tenantId: string, offerId: string): NodeOfferRecord {
    const found = this.readAll().find((record) => record.id === offerId);
    if (!found) {
      throw new NodeOfferNotFoundError(offerId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "NodeOffer");
    return found;
  }

  /** 列出 tenant 的全部 offer 记录（其他租户的记录不可见）。 */
  listByTenant(tenantId: string): readonly NodeOfferRecord[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /**
   * 按能力查询可用要约：只返回该 tenant 的 status=published 且 capability_id 精确匹配的
   * 记录；draft / withdrawn / expired 绝不表面化。published 记录读取时再次过
   * nodeOfferSchema（fail-closed，损坏文件绝不作为可用要约出现）。
   */
  listPublishedByCapability(tenantId: string, capabilityId: string): readonly NodeOffer[] {
    const published = this.readAll().filter(
      (record) =>
        record.tenant_id === tenantId &&
        record.status === NODE_OFFER_STATUS_PUBLISHED &&
        record.capability_id === capabilityId,
    );
    return published.map(
      (record) => parseOrFail("NodeOffer", nodeOfferSchema, record) as NodeOffer,
    );
  }

  /**
   * 发布 offer（fail-closed 门禁）：
   * 可选补丁先逐字应用（出现的键替换、缺席的键保持原值、无默认），
   * 缺失披露非空 → OfferPublishBlockedError（携带缺失字段名）；
   * 可发布 → nodeOfferSchema 物化（status=published + updated_at=时钟当前值）
   * + assertNodeOfferPublishable 最终守卫 → 持久化并返回 published 记录。
   */
  publish(tenantId: string, offerId: string, input?: OfferPublishInput): NodeOffer {
    const all = this.readAll();
    const current = all.find((record) => record.id === offerId);
    if (!current) {
      throw new NodeOfferNotFoundError(offerId);
    }
    assertTenantScope(current, { tenant_id: tenantId }, "NodeOffer");

    const patched =
      input === undefined
        ? current
        : applyOfferPublishPatch(
            current,
            parseOrFail(
              "OfferPublishInput",
              offerPublishInputSchema,
              input,
            ) as OfferPublishInput,
          );

    const missing = missingOfferDisclosures(patched);
    if (missing.length > 0) {
      throw new OfferPublishBlockedError(missing);
    }

    const published = this.toPublished(patched, this.time.now());
    this.writeAll(all.map((record) => (record === current ? published : record)));
    return published;
  }

  /**
   * 撤回 offer：status=withdrawn + updated_at 推进；已 withdrawn 的记录幂等直返
   * （不写入、不改时间戳）。撤回后的要约不再出现在 published 列表。
   */
  withdraw(tenantId: string, offerId: string): NodeOfferRecord {
    const all = this.readAll();
    const current = all.find((record) => record.id === offerId);
    if (!current) {
      throw new NodeOfferNotFoundError(offerId);
    }
    assertTenantScope(current, { tenant_id: tenantId }, "NodeOffer");

    if (current.status === NODE_OFFER_STATUS_WITHDRAWN) {
      return current;
    }

    const withdrawn = parseOrFail(
      "NodeOfferRecord",
      nodeOfferRecordSchema,
      {
        ...current,
        status: NODE_OFFER_STATUS_WITHDRAWN,
        updated_at: this.time.now(),
      },
    ) as NodeOfferRecord;

    this.writeAll(all.map((record) => (record === current ? withdrawn : record)));
    return withdrawn;
  }

  /**
   * published 记录物化（唯一入口）：nodeOfferSchema 全量校验（缺任何必填形状
   * ——含 inputs 为 null——都 fail-closed 抛 ContractValidationError，绝不静默默认）
   * + assertNodeOfferPublishable 最终守卫（invariants §14）。
   */
  private toPublished(record: NodeOfferRecord, updatedAt: string): NodeOffer {
    const published = parseOrFail("NodeOffer", nodeOfferSchema, {
      ...record,
      status: NODE_OFFER_STATUS_PUBLISHED,
      updated_at: updatedAt,
    }) as NodeOffer;
    assertNodeOfferPublishable(published);
    return published;
  }

  private get filePath(): string {
    return join(this.directory, STORE_FILE_NAME);
  }

  /** 读边界：容忍未知键（additive），但结构与 schema 损坏必须 fail-closed。 */
  private readAll(): readonly NodeOfferRecord[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("NodeOfferStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("NodeOfferStore", [
        "存储文件结构必须是 { version, node_offers }",
      ]);
    }
    const offers = (parsed as { node_offers?: unknown }).node_offers;
    if (!Array.isArray(offers)) {
      throw new ContractValidationError("NodeOfferStore", [
        "存储文件缺少 node_offers 数组",
      ]);
    }
    return offers.map(
      (record) => parseOrFail("NodeOfferRecord", nodeOfferRecordSchema, record) as NodeOfferRecord,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(offers: readonly NodeOfferRecord[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, node_offers: offers }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
