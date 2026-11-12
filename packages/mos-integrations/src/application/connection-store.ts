import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  assertConnectionHoldsNoSecrets,
  InvariantViolation,
  parseOrFail,
  providerConnectionSchema,
  providerConnectionUpsertSchema,
  type ProviderConnection,
} from "@mos/contracts";

/**
 * Tenant-scoped 连接存储（fail-closed 写边界）。
 *
 * 持久化：单个 JSON 文件（目录注入、文件名固定 mos-connections.json），
 * 原子写（临时文件 + rename），缺失文件按空库启动。文件形状带版本号，
 * 读边界容忍未知键（additive 演化），写边界不宽容（见下）。
 *
 * Tenant 隔离：tenant_id 只来自方法参数（组合根经 identity-bridge 解析注入），
 * 绝不来自调用方传入的记录体；所有读方法都按 tenant 过滤，跨 tenant 永远查不到。
 *
 * 密钥约定（AGENTS.md §4 / strategy §4）：不建第二凭据存储。记录只允许持有
 * 指向 ZCode 凭据存储的不透明 credential_ref（形如 mcp:oauth:<24hex>）。
 * 写路径三重 fail-closed：
 * 1. 未知字段直接拒绝（zod 默认会剥未知键，这里显式白名单，防止 access_token
 *    之类字段静默混入）；
 * 2. providerConnectionUpsertSchema 契约校验（opaqueRefSchema 拒绝内联令牌值）；
 * 3. assertConnectionHoldsNoSecrets 不变量守卫（字段名/值形状扫描）。
 */

const FILE_NAME = "mos-connections.json";

/** 存储文件信封：版本 + 连接数组（读边界解析，防手改文件混入非法记录）。 */
const connectionFileSchema = z.object({
  version: z.number().int().min(1),
  connections: z.array(providerConnectionSchema),
});

/** 写入输入：契约 upsert 输入去掉 id/tenant_id（id 由本存储生成，tenant_id 由参数定）。 */
export type ConnectionUpsertInput = Omit<
  z.input<typeof providerConnectionUpsertSchema>,
  "id" | "tenant_id"
> & {
  id?: string;
};

/** upsert 输入允许的键（白名单来源：providerConnectionUpsertSchema 的字段集）。 */
const UPSERT_INPUT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "provider_id",
  "provider_account_id",
  "auth_method",
  "credential_ref",
  "granted_scopes",
  "account_type",
  "app_review_status",
  "status",
  "last_verified_at",
]);

export class ConnectionStore {
  private readonly directory: string;

  constructor(deps: { directory: string }) {
    this.directory = deps.directory;
  }

  /**
   * 新建/更新连接（按 id upsert）。id 未提供时由 crypto.randomUUID() 生成；
   * tenant_id 只取参数。返回的记录已通过契约校验并已原子落盘。
   */
  async upsertConnection(tenantId: string, input: ConnectionUpsertInput): Promise<ProviderConnection> {
    assertNoUnknownUpsertKeys(input);
    const record = parseOrFail("ProviderConnectionUpsert", providerConnectionUpsertSchema, {
      ...input,
      id: input.id ?? randomUUID(),
      tenant_id: tenantId,
    }) as ProviderConnection;
    assertConnectionHoldsNoSecrets(record);

    const file = await this.load();
    const index = file.connections.findIndex(
      (connection) => connection.tenant_id === tenantId && connection.id === record.id,
    );
    if (index >= 0) {
      file.connections[index] = record;
    } else {
      file.connections.push(record);
    }
    await this.save(file);
    return record;
  }

  /** 读取单条连接（tenant + provider + id 三重限定；跨 tenant 一律 null）。 */
  async getConnection(
    tenantId: string,
    providerId: string,
    connectionId: string,
  ): Promise<ProviderConnection | null> {
    const file = await this.load();
    return (
      file.connections.find(
        (connection) =>
          connection.tenant_id === tenantId &&
          connection.provider_id === providerId &&
          connection.id === connectionId,
      ) ?? null
    );
  }

  /** 列出 tenant 在某 provider 下的全部连接（tenant 隔离，顺序稳定）。 */
  async listConnections(tenantId: string, providerId: string): Promise<readonly ProviderConnection[]> {
    const file = await this.load();
    return file.connections.filter(
      (connection) => connection.tenant_id === tenantId && connection.provider_id === providerId,
    );
  }

  /** 删除连接（tenant + provider + id 限定）；不存在/跨 tenant 返回 false。 */
  async deleteConnection(
    tenantId: string,
    providerId: string,
    connectionId: string,
  ): Promise<boolean> {
    const file = await this.load();
    const index = file.connections.findIndex(
      (connection) =>
        connection.tenant_id === tenantId &&
        connection.provider_id === providerId &&
        connection.id === connectionId,
    );
    if (index < 0) return false;
    file.connections.splice(index, 1);
    await this.save(file);
    return true;
  }

  /** 落盘文件绝对路径（测试/诊断用）。 */
  filePath(): string {
    return join(this.directory, FILE_NAME);
  }

  /**
   * 读边界：每次操作都从磁盘加载（多实例/多进程一致）。
   * 文件缺失 → 空库；JSON 损坏或记录非法 → 抛错（fail-closed，不静默清库）。
   */
  private async load(): Promise<{ version: number; connections: ProviderConnection[] }> {
    let rawText: string;
    try {
      rawText = await readFile(this.filePath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, connections: [] };
      }
      throw error;
    }
    const file = parseOrFail(
      "ConnectionStoreFile",
      connectionFileSchema,
      JSON.parse(rawText) as unknown,
    );
    for (const connection of file.connections) {
      assertConnectionHoldsNoSecrets(connection);
    }
    return { version: file.version, connections: [...file.connections] };
  }

  /** 原子写：临时文件 + rename（进程中断不会留下半写文件）。 */
  private async save(file: { version: number; connections: readonly ProviderConnection[] }): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const tempPath = join(this.directory, `.${FILE_NAME}.${randomUUID()}.tmp`);
    await writeFile(tempPath, JSON.stringify(file, null, 2), "utf8");
    await rename(tempPath, this.filePath());
  }
}

/** fail-closed 写边界：upsert 输入只允许契约白名单字段（多余键拒绝，绝不静默剥离）。 */
function assertNoUnknownUpsertKeys(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  const unknownKeys = Object.keys(input).filter((key) => !UPSERT_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new InvariantViolation(
      "connection-store-write-boundary",
      `连接写入拒绝未知字段: ${unknownKeys.join(", ")}`,
    );
  }
}
