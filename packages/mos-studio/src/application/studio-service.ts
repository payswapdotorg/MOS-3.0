import { randomUUID } from "node:crypto";
import type { ProviderPort, TimePort } from "@mos/adapters";
import { classifyProviderError, providerErrorAction } from "@mos/adapters";
import type { TenantContext, Mission } from "@mos/contracts";
import { CapabilityCatalog, CapabilityInstanceResolverService } from "@mos/capabilities";
import { IdentityBridgeService } from "@mos/identity-bridge";
import {
  COMPOSIO_SESSION_FACTORY_URL,
  ConnectionStore,
  summarizeProviderReadResult,
  type ProviderReadShape,
} from "@mos/integrations";
import { MissionStore, missionFromIntake } from "@mos/missions";
import { RouteService, compareRoutes, type RouteInstanceFact } from "@mos/routes";
import {
  COMPOSIO_CONNECTION_ID,
  COMPOSIO_CREDENTIAL_REF,
  READ_LIMIT_DEFAULT,
  READ_LIMIT_MAX,
  READ_LIMIT_MIN,
  READ_QUERY_MAX_LENGTH,
  READ_TIMEOUT_MS,
  SESSION_FACTORY_TIMEOUT_MS,
  STUDIO_COMPOSIO_CAPABILITY_ID,
  STUDIO_COMPOSIO_IMPLEMENTATION_ID,
} from "../contract/studio-vocabulary.js";
import type { OperatorRecord } from "../contract/operator.js";
import { operatorAsUserIdentity } from "../contract/operator.js";
import type { ToolCallMeta } from "../contract/session-context.js";
import {
  capabilityInstanceView,
  connectionView,
  missionView,
  routesView,
  type CapabilityInstanceView,
  type ConnectionView,
  type MissionView,
  type RoutesView,
} from "../domain/journey-projection.js";
import {
  resolveStudioAvailability,
  type StudioAvailability,
} from "../domain/availability.js";
import { OperatorStore } from "./operator-store.js";
import {
  createComposioSession,
  ComposioSessionError,
  type ComposioSession,
} from "./composio-session-client.js";
import {
  studioComposioDiscussionSearchDescriptor,
  studioComposioDiscussionSearchImplementation,
} from "./catalog-data.js";

/**
 * mos-studio 组合根服务（TL）：把 @mos/* 各权威模块组合成 New Task → Mission →
 * capabilities → routes → authorized read 的完整旅程。
 *
 * 纪律（与 AGENTS.md / 前几周一致）：
 * - 所有 provider I/O 只经注入端口（ProviderPort / CredentialStorePort / fetch），
 *   生产真实栈由 src/runtime 注入（真实 ZCode MCP 客户端 + 真实加密凭据存储）；
 * - 授权材料只在运行时经端口流动，绝不进源码/日志/返回值；
 * - 一切失败 fail-closed 类型化（不静默降级、不换 tenant、不编造连接）；
 * - 只投影 counts/shapes，绝不复制 provider 记录内容；
 * - ZCode 会话仍是会话/任务状态的唯一权威（这里只存引用）。
 */

/** 结构化凭据端口（生产 = 真实共享 ZCode 凭据存储；工程测试 = 内存替身）。 */
export interface CredentialStorePort {
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;
}

export interface StudioPorts {
  /** 每次读一个全新 ProviderPort（真实 = 每读一个新 createMcpAdapter）。 */
  readonly createProviderPort: () => ProviderPort;
  readonly credentialStore: CredentialStorePort;
  readonly time: TimePort;
  readonly fetch: typeof globalThis.fetch;
}

/** tools/call `_meta` 提取的会话事实（缺失字段如实为 null）。 */
export interface StudioSessionContext {
  readonly sessionId: string | null;
  readonly workspacePath: string | null;
  readonly workspaceIdentity: string | null;
  readonly workspaceKey: string | null;
}

export function studioSessionContextFromMeta(meta: ToolCallMeta | null): StudioSessionContext {
  if (!meta) {
    return {
      sessionId: null,
      workspacePath: null,
      workspaceIdentity: null,
      workspaceKey: null,
    };
  }
  return {
    sessionId: meta.session_id ?? null,
    workspacePath: meta.workspace_path ?? null,
    workspaceIdentity: meta.workspace_identity ?? null,
    workspaceKey: meta.workspace_key ?? null,
  };
}

export type StudioTenantResolution =
  | { readonly status: "resolved"; readonly tenant: TenantContext }
  | { readonly status: "unavailable"; readonly reason: string };

export interface StudioServiceDeps {
  /** $ZCODE_PLUGIN_DATA（null = 未提供：持久化与 tenant 解析 fail-closed）。 */
  readonly dataDir: string | null;
  readonly ports: StudioPorts;
  /** session 工厂 URL（缺省真实工厂；集成测试注入本地替身）。 */
  readonly composioSessionFactoryUrl?: string;
}

export class StudioService {
  private readonly operatorStore: OperatorStore | null;
  private readonly missionStore: MissionStore | null;
  private readonly connectionStore: ConnectionStore | null;
  private readonly catalog: CapabilityCatalog;
  private readonly resolver: CapabilityInstanceResolverService;
  private readonly routeService: RouteService;

  constructor(deps: StudioServiceDeps) {
    this.operatorStore = deps.dataDir ? new OperatorStore({ directory: deps.dataDir }) : null;
    this.missionStore = deps.dataDir
      ? new MissionStore({ directory: deps.dataDir, time: deps.ports.time })
      : null;
    this.connectionStore = deps.dataDir ? new ConnectionStore({ directory: deps.dataDir }) : null;
    this.catalog = new CapabilityCatalog();
    this.catalog.register(studioComposioDiscussionSearchDescriptor());
    this.catalog.registerImplementation(studioComposioDiscussionSearchImplementation());
    this.resolver = new CapabilityInstanceResolverService({
      catalog: this.catalog,
      time: deps.ports.time,
    });
    this.routeService = new RouteService({ time: deps.ports.time });
    this.deps = deps;
  }

  private readonly deps: StudioServiceDeps;

  /** 每请求 tenant 解析：会话事实（_meta）+ 操作者声明 → IdentityBridgeService 同一语义。 */
  async resolveTenant(
    context: StudioSessionContext,
  ): Promise<StudioTenantResolution> {
    const operator = this.operatorStore ? await this.operatorStore.load() : null;
    const bridge = new IdentityBridgeService({
      sessionFacts: {
        currentSession: () =>
          Promise.resolve({
            sessionId: context.sessionId,
            taskId: context.sessionId,
            workspace: context.workspacePath
              ? {
                  workspacePath: context.workspacePath,
                  workspaceIdentity: context.workspaceIdentity,
                  workspaceKey:
                    context.workspaceIdentity?.trim() || context.workspaceKey || context.workspacePath,
                  projectId: null,
                }
              : null,
          }),
        currentUser: () =>
          Promise.resolve(operator ? operatorAsUserIdentity(operator) : null),
      },
    });
    const resolution = await bridge.resolveTenantContext();
    if (resolution.status === "resolved") {
      return { status: "resolved", tenant: resolution.tenantContext };
    }
    return { status: "unavailable", reason: resolution.reason };
  }

  async operator(): Promise<OperatorRecord | null> {
    return this.operatorStore ? this.operatorStore.load() : null;
  }

  async setOperator(input: {
    userId: string;
    organizationId: string | null;
  }): Promise<OperatorRecord> {
    if (!this.operatorStore) throw new StudioDataDirUnavailableError();
    return this.operatorStore.save({
      userId: input.userId,
      organizationId: input.organizationId,
      declaredAt: this.deps.ports.time.now(),
    });
  }

  async listMissions(
    context: StudioSessionContext,
    filter?: { source_zcode_session_id?: string | null },
  ): Promise<readonly MissionView[]> {
    const tenant = await this.requireTenant(context);
    if (!this.missionStore) throw new StudioDataDirUnavailableError();
    const missions = this.missionStore.listMissions(
      tenant.tenant_id,
      filter && filter.source_zcode_session_id !== undefined
        ? { source_zcode_session_id: filter.source_zcode_session_id }
        : undefined,
    );
    return missions.map(missionView);
  }

  /** 当前会话已关联的 mission（sidecar 或 intake 创建；只读投影）。 */
  async linkedMission(context: StudioSessionContext): Promise<Mission | null> {
    if (!context.sessionId) return null;
    const tenant = await this.requireTenant(context);
    if (!this.missionStore) throw new StudioDataDirUnavailableError();
    const missions = this.missionStore.listMissions(tenant.tenant_id, {
      source_zcode_session_id: context.sessionId,
    });
    return missions[0] ?? null;
  }

  /** 逐字 intake（面板表单 = 人的逐字输入通道；零推断）。 */
  async recordMissionIntake(
    context: StudioSessionContext,
    input: {
      objective_verbatim: string;
      target_audience?: string | null;
      geography?: string | null;
      desired_outcomes?: readonly string[];
      success_metrics?: readonly string[];
      budget?: { amount: string; currency: string } | null;
      deadline?: string | null;
    },
  ): Promise<MissionView> {
    const tenant = await this.requireTenant(context);
    if (!this.missionStore) throw new StudioDataDirUnavailableError();
    const mission = missionFromIntake(
      {
        tenant_id: tenant.tenant_id,
        workspace_id: tenant.workspace_id,
        objective_verbatim: input.objective_verbatim,
        source_zcode_session_id: context.sessionId,
        source_zcode_task_id: context.sessionId,
        target_audience: input.target_audience ?? null,
        geography: input.geography ?? null,
        desired_outcomes: [...(input.desired_outcomes ?? [])],
        success_metrics: [...(input.success_metrics ?? [])],
        budget: input.budget ?? null,
        deadline: input.deadline ?? null,
      },
      { now: this.deps.ports.time.now(), id: `mos-mission-${randomUUID()}` },
    );
    const saved = this.missionStore.saveMission(tenant.tenant_id, mission);
    return missionView(saved);
  }

  /** 连接 Composio：key 只进真实凭据端口；连接记录只存不透明引用。 */
  async connectComposio(
    context: StudioSessionContext,
    input: { apiKey: string },
  ): Promise<ConnectionView> {
    const tenant = await this.requireTenant(context);
    if (!this.connectionStore) throw new StudioDataDirUnavailableError();
    const apiKey = input.apiKey.trim();
    if (apiKey.length === 0) throw new StudioInvalidInputError("api_key must be a non-blank string");
    await this.deps.ports.credentialStore.save(COMPOSIO_CREDENTIAL_REF, apiKey);
    const connection = await this.connectionStore.upsertConnection(tenant.tenant_id, {
      id: COMPOSIO_CONNECTION_ID,
      provider_id: "composio",
      provider_account_id: null,
      auth_method: "api_key",
      credential_ref: COMPOSIO_CREDENTIAL_REF,
      granted_scopes: [],
      account_type: null,
      app_review_status: null,
      status: "connected",
      last_verified_at: this.deps.ports.time.now(),
    });
    return connectionView(connection);
  }

  async listConnections(context: StudioSessionContext): Promise<readonly ConnectionView[]> {
    const tenant = await this.requireTenant(context);
    if (!this.connectionStore) throw new StudioDataDirUnavailableError();
    const connections = await this.connectionStore.listConnections(tenant.tenant_id, "composio");
    return connections.map(connectionView);
  }

  /** 已连接账户的能力实例解析（fail-closed；toolMappingVerified 如实携带）。 */
  async capabilities(context: StudioSessionContext): Promise<readonly CapabilityInstanceView[]> {
    const tenant = await this.requireTenant(context);
    if (!this.connectionStore) throw new StudioDataDirUnavailableError();
    const connections = await this.connectionStore.listConnections(tenant.tenant_id, "composio");
    const views: CapabilityInstanceView[] = [];
    for (const connection of connections) {
      try {
        const instance = this.resolver.resolveForConnection({
          tenantId: tenant.tenant_id,
          connection,
          capabilityId: STUDIO_COMPOSIO_CAPABILITY_ID,
          implementationId: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
        });
        const descriptor = this.catalog.getDescriptor(STUDIO_COMPOSIO_CAPABILITY_ID);
        views.push(capabilityInstanceView(instance, descriptor?.toolMapping.verified ?? false));
      } catch (error) {
        // 解析失败如实投影为 unknown 实例（fail-closed，不静默跳过；分类原因可审计）。
        views.push({
          capability_id: STUDIO_COMPOSIO_CAPABILITY_ID,
          implementation_id: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
          status: "unknown",
          support_status: "unknown",
          missing_preconditions: [`resolver_error:${describeError(error)}`],
          tool_mapping_verified: false,
        });
      }
    }
    return views;
  }

  /** 路由候选评估（existing/conditional/blocked/unknown）。 */
  async routes(
    context: StudioSessionContext,
    missionId?: string,
  ): Promise<RoutesView> {
    const tenant = await this.requireTenant(context);
    if (!this.missionStore || !this.connectionStore) throw new StudioDataDirUnavailableError();
    let mission: Mission | null = null;
    if (missionId) {
      mission = this.missionStore.getMission(tenant.tenant_id, missionId);
      if (!mission) throw new StudioMissionNotFoundError(missionId);
    } else {
      if (!context.sessionId) throw new StudioInvalidInputError("session context has no session id");
      const missions = this.missionStore.listMissions(tenant.tenant_id, {
        source_zcode_session_id: context.sessionId,
      });
      mission = missions[0] ?? null;
      if (!mission) throw new StudioMissionNotFoundError("(linked to current session)");
    }
    const connections = await this.connectionStore.listConnections(tenant.tenant_id, "composio");
    const facts: RouteInstanceFact[] = [];
    for (const connection of connections) {
      try {
        const instance = this.resolver.resolveForConnection({
          tenantId: tenant.tenant_id,
          connection,
          capabilityId: STUDIO_COMPOSIO_CAPABILITY_ID,
          implementationId: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
        });
        const descriptor = this.catalog.getDescriptor(STUDIO_COMPOSIO_CAPABILITY_ID);
        // 副作用由描述符配对（描述符未声明时如实 unknown——路由评估纪律）。
        facts.push({
          instance,
          side_effect: descriptor?.sideEffect ?? "unknown",
        });
      } catch {
        // 解析失败的连接不产生路由事实（其能力如实缺席；compareRoutes 会给出
        // no_capability_instances_resolved 的 unknown 路由）。
      }
    }
    const evaluation = this.routeService.candidatesForMission(mission, facts);
    const summary = compareRoutes(evaluation.routes);
    return routesView(mission.id, evaluation.routes, summary);
  }

  /**
   * 一次真实授权读（Composio session MCP → HACKERNEWS_SEARCH_POSTS）：
   * tenant → 连接 → 能力可用性 → 凭据 → session 工厂 → 真实 MCP 客户端 → counts/shapes 证据。
   */
  async executeAuthorizedRead(
    context: StudioSessionContext,
    input: { query: string; limit?: number },
  ): Promise<StudioReadOutcome> {
    const query = input.query.trim();
    if (query.length === 0)
      throw new StudioInvalidInputError("query must be a non-blank string");
    if (query.length > READ_QUERY_MAX_LENGTH)
      throw new StudioInvalidInputError(`query must be at most ${READ_QUERY_MAX_LENGTH} characters`);
    const limit = input.limit ?? READ_LIMIT_DEFAULT;
    if (!Number.isInteger(limit) || limit < READ_LIMIT_MIN || limit > READ_LIMIT_MAX)
      throw new StudioInvalidInputError(`limit must be an integer in [${READ_LIMIT_MIN}, ${READ_LIMIT_MAX}]`);

    const tenant = await this.requireTenant(context);
    if (!this.connectionStore) throw new StudioDataDirUnavailableError();
    const connection = await this.connectionStore.getConnection(
      tenant.tenant_id,
      "composio",
      COMPOSIO_CONNECTION_ID,
    );
    if (!connection) throw new StudioConnectionNotFoundError();

    const instance = this.resolver.resolveForConnection({
      tenantId: tenant.tenant_id,
      connection,
      capabilityId: STUDIO_COMPOSIO_CAPABILITY_ID,
      implementationId: STUDIO_COMPOSIO_IMPLEMENTATION_ID,
    });
    if (instance.status !== "available") {
      return {
        status: "blocked",
        reason: "capability_instance_not_available",
        missing_preconditions: [...instance.missing_preconditions],
      };
    }

    const apiKey = await this.deps.ports.credentialStore.load(COMPOSIO_CREDENTIAL_REF);
    if (!apiKey || apiKey.length === 0) {
      return { status: "blocked", reason: "credential_missing", missing_preconditions: [] };
    }

    const operator = this.operatorStore ? await this.operatorStore.load() : null;
    let session: ComposioSession;
    try {
      session = await createComposioSession(
        {
          factoryUrl: this.deps.composioSessionFactoryUrl ?? COMPOSIO_SESSION_FACTORY_URL,
          fetch: this.deps.ports.fetch,
          timeoutMs: SESSION_FACTORY_TIMEOUT_MS,
        },
        { apiKey, userId: operator?.userId ?? tenant.actor_id },
      );
    } catch (error) {
      const httpStatus = error instanceof ComposioSessionError ? error.httpStatus : null;
      const classified = classifyProviderError({
        message: error instanceof Error ? error.message : String(error),
        httpStatus,
      });
      return {
        status: "failed",
        stage: "session_factory",
        classified: classified.kind,
        action: providerErrorAction(classified.kind),
      };
    }

    const provider = this.deps.ports.createProviderPort();
    try {
      const state = await provider.connectServer("composio-session", {
        kind: "http",
        url: session.mcpUrl,
        headers: { "x-api-key": apiKey },
      });
      if (state.status !== "connected") {
        const classified = classifyProviderError({ message: state.error ?? "connect failed" });
        return {
          status: "failed",
          stage: "connect",
          classified: classified.kind,
          action: providerErrorAction(classified.kind),
        };
      }
      const result = await provider.callTool({
        serverName: "composio-session",
        toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: {
          tools: [
            {
              tool_slug: "HACKERNEWS_SEARCH_POSTS",
              arguments: { query, size: limit },
            },
          ],
          thought: "MOS studio authorized read (operator-initiated, read-only)",
        },
        timeoutMs: READ_TIMEOUT_MS,
      });
      if (result.isError) {
        const classified = classifyProviderError({
          message: textOf(result.content),
          content: [...result.content],
        });
        return {
          status: "failed",
          stage: "call",
          classified: classified.kind,
          action: providerErrorAction(classified.kind),
        };
      }
      const shape = summarizeProviderReadResult(result);
      // Composio 文档化响应形状的计数投影（组合层 provider-shape 知识；只取计数，不取记录值）：
      // {successful, data: {results: [...], total_count, success_count, error_count}, log_id}。
      // 形状不符 → 无 composio 计数（base shape 的 recordCount 保持 unknown=null，绝不猜值）。
      const composioCounts = composioMultiExecuteCounts(result);
      return {
        status: "succeeded",
        evidence: {
          kind: "provider_response",
          observed_via: "composio-session-mcp",
          tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
          connection_id: connection.id,
          session_ref: session.sessionId,
          observed_at: this.deps.ports.time.now(),
          facts: { ...shape, ...(composioCounts ? { composio: composioCounts } : {}) },
        },
      };
    } finally {
      await provider.close();
    }
  }

  /** 状态工具聚合（面板首屏同款数据）。 */
  async status(context: StudioSessionContext): Promise<StudioStatusView> {
    const operator = await this.operator();
    const tenant = await this.resolveTenant(context);
    let mission: MissionView | null = null;
    let connections: readonly ConnectionView[] = [];
    if (tenant.status === "resolved") {
      const linked = await this.linkedMission(context);
      mission = linked ? missionView(linked) : null;
      connections = await this.listConnections(context);
    }
    const sessionContextAvailable = context.workspaceKey !== null || context.workspacePath !== null;
    const availability: StudioAvailability = resolveStudioAvailability({
      hostState: "running",
      mosEnabled: true,
      missionLinked: mission !== null,
      sessionContextAvailable,
    });
    return {
      operator_configured: operator !== null,
      tenant: tenant.status === "resolved" ? tenant.tenant.tenant_id : null,
      session: context.sessionId,
      workspace_key: context.workspaceKey ?? context.workspacePath,
      mission,
      connections,
      availability,
    };
  }

  private async requireTenant(context: StudioSessionContext): Promise<TenantContext> {
    // 数据目录缺失是最先失败的事实（否则 tenant 解析只会给出误导性的 user_identity_missing）
    if (!this.missionStore || !this.connectionStore || !this.operatorStore) {
      throw new StudioDataDirUnavailableError();
    }
    const resolution = await this.resolveTenant(context);
    if (resolution.status === "unavailable") {
      throw new StudioTenantUnavailableError(resolution.reason);
    }
    return resolution.tenant;
  }
}

export interface StudioStatusView {
  readonly operator_configured: boolean;
  readonly tenant: string | null;
  readonly session: string | null;
  readonly workspace_key: string | null;
  readonly mission: MissionView | null;
  readonly connections: readonly ConnectionView[];
  readonly availability: StudioAvailability;
}

export type StudioReadOutcome =
  | {
      readonly status: "succeeded";
      readonly evidence: {
        readonly kind: "provider_response";
        readonly observed_via: string;
        readonly tool: string;
        readonly connection_id: string;
        readonly session_ref: string;
        readonly observed_at: string;
        readonly facts: ProviderReadShape;
      };
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
      readonly missing_preconditions: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly stage: "session_factory" | "connect" | "call";
      readonly classified: string;
      readonly action: string;
    };

export class StudioDataDirUnavailableError extends Error {
  constructor() {
    super("mos-studio plugin data dir unavailable (ZCODE_PLUGIN_DATA not set)");
    this.name = "StudioDataDirUnavailableError";
  }
}

export class StudioTenantUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`tenant unavailable: ${reason}`);
    this.reason = reason;
    this.name = "StudioTenantUnavailableError";
  }
}

export class StudioInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioInvalidInputError";
  }
}

export class StudioConnectionNotFoundError extends Error {
  constructor() {
    super("composio connection not found for this tenant");
    this.name = "StudioConnectionNotFoundError";
  }
}

export class StudioMissionNotFoundError extends Error {
  readonly missionId: string;
  constructor(missionId: string) {
    super(`mission not found: ${missionId}`);
    this.missionId = missionId;
    this.name = "StudioMissionNotFoundError";
  }
}

function textOf(content: readonly unknown[]): string {
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block && typeof (block as { text: unknown }).text === "string") {
      return (block as { text: string }).text;
    }
  }
  return "";
}

/** Composio MULTI_EXECUTE 文档化形状的计数（只有数；形状不符 → null，绝不猜）。 */
function composioMultiExecuteCounts(result: {
  content: readonly unknown[];
}): { results_count: number; total_count: number | null; success_count: number | null } | null {
  const text = textOf(result.content);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const data = (parsed as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const results = (data as Record<string, unknown>).results;
  if (!Array.isArray(results)) return null;
  const toCount = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) ? value : null;
  return {
    results_count: results.length,
    total_count: toCount((data as Record<string, unknown>).total_count),
    success_count: toCount((data as Record<string, unknown>).success_count),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
