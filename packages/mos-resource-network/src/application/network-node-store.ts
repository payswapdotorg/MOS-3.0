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
  networkNodeSchema,
  parseOrFail,
} from "@mos/contracts";
import type { NetworkNode, NetworkNodeStatus } from "@mos/contracts";
import {
  NetworkNodeNotFoundError,
  NetworkNodeValidationError,
  networkNodeRegistrationInputSchema,
} from "../contract/network-node.js";
import type { NetworkNodeRegistrationInput } from "../contract/network-node.js";
import { networkNodeFromInput } from "../domain/network-node.js";
import { describeError } from "./support.js";

const STORE_FILE_NAME = "mos-network-nodes.json";
const STORE_SCHEMA_VERSION = 1;

export interface NetworkNodeStoreOptions {
  /** 持久目录（注入；目录不存在时首次写入自动创建）。 */
  readonly directory: string;
}

/**
 * 持久 tenant-scoped NetworkNode 存储（与 W2/W3 各 store 同模式）。
 * - 文件后端、原子写（同目录 tmp + rename）、fail-closed 读取（损坏即拒读）。
 * - 读取容忍未知键（additive 契约演化），结构/schema 破坏必须 fail-closed。
 * - 租户边界：跨租户读/写一律 InvariantViolation（绝不静默降级）。
 */
export class NetworkNodeStore {
  private readonly directory: string;

  constructor(options: NetworkNodeStoreOptions) {
    this.directory = options.directory;
  }

  /** 登记节点（upsert by id；登记恒为 active，重复 id = 覆盖更新）。 */
  registerNode(
    tenantId: string,
    nodeId: string,
    input: NetworkNodeRegistrationInput,
    deps: { now: string },
  ): NetworkNode {
    let normalized: NetworkNodeRegistrationInput;
    try {
      normalized = parseOrFail(
        "NetworkNodeRegistrationInput",
        networkNodeRegistrationInputSchema,
        input,
      ) as NetworkNodeRegistrationInput;
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new NetworkNodeValidationError(error.issues);
      }
      throw error;
    }
    const record = networkNodeFromInput(normalized, { id: nodeId, now: deps.now });
    assertTenantScope(record, { tenant_id: tenantId }, "network node");
    const all = this.readAll();
    this.persist(all, record);
    return record;
  }

  getNode(tenantId: string, nodeId: string): NetworkNode | null {
    const found = this.readAll().find((record) => record.id === nodeId);
    if (found === undefined) return null;
    assertTenantScope(found, { tenant_id: tenantId }, "network node");
    return found;
  }

  /** 列出调用方租户的全部节点（其他租户的记录不可见）。 */
  listNodesByTenant(tenantId: string): readonly NetworkNode[] {
    return this.readAll().filter((record) => record.tenant_id === tenantId);
  }

  /** 状态切换（active/inactive；§26：inactive 由发现层具名浮出，绝不静默隐藏）。 */
  setStatus(
    tenantId: string,
    nodeId: string,
    status: NetworkNodeStatus,
    deps: { now: string },
  ): NetworkNode {
    if (status === "unknown") {
      throw new NetworkNodeValidationError(["状态不可手工设为 unknown（fail-closed）"]);
    }
    const all = this.readAll();
    const current = this.findNode(all, tenantId, nodeId);
    const next: NetworkNode = { ...current, status, updated_at: deps.now };
    this.persist(all, next);
    return next;
  }

  private findNode(
    all: readonly NetworkNode[],
    tenantId: string,
    nodeId: string,
  ): NetworkNode {
    const found = all.find((record) => record.id === nodeId);
    if (found === undefined) {
      throw new NetworkNodeNotFoundError(tenantId, nodeId);
    }
    assertTenantScope(found, { tenant_id: tenantId }, "network node");
    return found;
  }

  /** 落盘前统一守卫：schema 再校验（defense in depth）。 */
  private persist(all: readonly NetworkNode[], record: NetworkNode): void {
    const validated = parseOrFail(
      "NetworkNode",
      networkNodeSchema,
      record,
    ) as NetworkNode;
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
  private readAll(): readonly NetworkNode[] {
    if (!existsSync(this.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new ContractValidationError("NetworkNodeStore", [
        `存储文件不是合法 JSON: ${describeError(error)}`,
      ]);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractValidationError("NetworkNodeStore", [
        "存储文件结构必须是 { version, network_nodes }",
      ]);
    }
    const nodes = (parsed as { network_nodes?: unknown }).network_nodes;
    if (!Array.isArray(nodes)) {
      throw new ContractValidationError("NetworkNodeStore", [
        "存储文件缺少 network_nodes 数组",
      ]);
    }
    return nodes.map(
      (record) => parseOrFail("NetworkNode", networkNodeSchema, record) as NetworkNode,
    );
  }

  /** 原子写：先写同目录 tmp 文件再 rename，避免半写文件被读到。 */
  private writeAll(nodes: readonly NetworkNode[]): void {
    mkdirSync(this.directory, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: STORE_SCHEMA_VERSION, network_nodes: nodes }, null, 2)}\n`,
      "utf8",
    );
    renameSync(tmpPath, this.filePath);
  }
}
