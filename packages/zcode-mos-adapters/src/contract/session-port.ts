/**
 * Session 底物端口：ZCode 身份/工作区/会话事实的唯一只读来源（W1-C 任务侧）。
 * 现有 ZCode 会话仍是消息与通用任务状态的唯一权威（AGENTS.md §2）；
 * MOS 只消费事实，绝不复制会话状态或改写任务路径。
 */

export interface ZCodeWorkspaceFacts {
  /** 工作区路径（本地绝对路径或远程标识的路径部分）。 */
  readonly workspacePath: string;
  /** 远程身份（remote:ssh:... 等）；本地工作区为 null。 */
  readonly workspaceIdentity: string | null;
  /** 解析后的工作区键：workspaceIdentity?.trim() || workspacePath（与 ZCode 一致）。 */
  readonly workspaceKey: string;
  /** ZCode 项目 id（proj_<sanitized-path>）；不可得时为 null。 */
  readonly projectId: string | null;
}

export interface ZCodeSessionFacts {
  /** ZCode agent 会话 id（sess_*）。 */
  readonly sessionId: string | null;
  /** UI taskId 与 agent sessionId 一致（ZCode 事实，不是独立 id 体系）。 */
  readonly taskId: string | null;
  readonly workspace: ZCodeWorkspaceFacts | null;
}

export interface ZCodeUserIdentity {
  /** ZCode/Z.ai 账户用户 id。 */
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly loginProvider: string | null;
}

/** 任务创建成功后的事件事实：sidecar 只允许在此之后关联（graceful-failure 约定）。 */
export interface TaskCreatedEvent {
  readonly sessionId: string;
  readonly taskId: string;
  readonly workspace: ZCodeWorkspaceFacts;
  readonly occurredAt: string;
}

export type TaskCreatedListener = (event: TaskCreatedEvent) => void;

export interface SessionFactsPort {
  currentSession(): Promise<ZCodeSessionFacts | null>;
  currentUser(): Promise<ZCodeUserIdentity | null>;
  /** 订阅"标准任务创建成功"事实；不支持时缺省为无订阅（fail-closed 到无 sidecar）。 */
  observeTaskCreated?(listener: TaskCreatedListener): () => void;
}

/** 时间端口：所有 observed_at / checked_at 必须经由此端口获得（可注入、可测试）。 */
export interface TimePort {
  now(): string;
}
