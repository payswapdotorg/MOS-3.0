import type { RightsRecord } from "@mos/contracts";
import type { TimePort } from "../contract/rights.js";
import type { RightsGateVerdict } from "../domain/rights-gate.js";
import { evaluateRightsGate } from "../domain/rights-gate.js";
import type { RightsRecordStore } from "./rights-store.js";

/**
 * RightsGateService：tenant-scoped 权利门禁评估（fail-closed，永不猜测）。
 *
 * - evaluateForArtifact(tenantId, artifactRef)：从 store 拉取该租户内与
 *   artifactRef 相关的记录（精确覆盖 + null 通配），以注入 TimePort 的 now
 *   调用纯门禁 evaluateRightsGate，返回判定对象（cleared + 具名 reason）；
 * - 未知 artifact（无任何覆盖记录）→ no_covering_record 拒绝
 *   （fail-closed：缺记录 = 拒绝，绝不猜测）；
 * - now 一律经注入 TimePort 获得（领域层零 Date/random，评估可复现）；
 * - 本服务只读（不写任何权利记录）；记录写入走 RightsRecordStore.saveRecord。
 */
export interface RightsGateServiceDeps {
  /** 权利记录存储（tenant-scoped 读取面）。 */
  readonly store: RightsRecordStore;
  /** 评估时钟（RFC3339 UTC；now 一律经端口获得）。 */
  readonly time: TimePort;
}

export class RightsGateService {
  private readonly store: RightsRecordStore;
  private readonly time: TimePort;

  constructor(deps: RightsGateServiceDeps) {
    this.store = deps.store;
    this.time = deps.time;
  }

  /** 评估 artifactRef 在该租户下当前时刻是否 cleared（永不猜测：全部拒绝路径具名）。 */
  evaluateForArtifact(tenantId: string, artifactRef: string): RightsGateVerdict {
    const records: readonly RightsRecord[] = this.store.listForArtifact(
      tenantId,
      artifactRef,
    );
    return evaluateRightsGate({
      artifactRef,
      records,
      now: this.time.now(),
    });
  }
}
