import type {
  SessionFactsPort,
  TaskCreatedEvent,
  TaskCreatedListener,
  ZCodeSessionFacts,
  ZCodeUserIdentity,
  ZCodeWorkspaceFacts,
} from "../contract/session-port.js";
import type { TimePort } from "../contract/session-port.js";

/**
 * 测试用会话事实端口 + 系统时钟（contract-only 替身）。
 */

export class InMemorySessionFactsPort implements SessionFactsPort {
  private session: ZCodeSessionFacts | null;
  private user: ZCodeUserIdentity | null;
  private readonly listeners = new Set<TaskCreatedListener>();

  constructor(options: { session?: ZCodeSessionFacts | null; user?: ZCodeUserIdentity | null } = {}) {
    this.session = options.session ?? null;
    this.user = options.user ?? null;
  }

  currentSession(): Promise<ZCodeSessionFacts | null> {
    return Promise.resolve(this.session);
  }

  currentUser(): Promise<ZCodeUserIdentity | null> {
    return Promise.resolve(this.user);
  }

  observeTaskCreated(listener: TaskCreatedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 测试钩子：模拟"标准任务创建成功"事实。 */
  emitTaskCreated(event: TaskCreatedEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** 系统时钟：RFC3339 UTC。领域层不得直接 new Date，一律经 TimePort。 */
export class SystemTimePort implements TimePort {
  now(): string {
    return new Date().toISOString();
  }
}

export function workspaceFactsFromPath(
  workspacePath: string,
  workspaceIdentity: string | null,
): ZCodeWorkspaceFacts {
  return {
    workspacePath,
    workspaceIdentity,
    workspaceKey: workspaceIdentity?.trim() || workspacePath,
    projectId: null,
  };
}
