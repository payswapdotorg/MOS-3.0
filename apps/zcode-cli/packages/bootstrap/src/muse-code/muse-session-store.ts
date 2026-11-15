import { readFile } from "node:fs/promises";
import type { MuseExecutionSurface } from "@zcode/contracts";
import {
  atomicWritePrivateTextFile,
  resolveMuseCodeSessionsFilePath,
} from "@zcode/shared/node";
// MOS 会话 ↔ muse 会话的持久映射（Issue #24 / ACR-0002；PR #27 评审 R2）。
//
// 边界与纪律：
// - 文件由本模块独占读写（bootstrap 端口内部状态），路径与 settings 同目录
//   （<homedir>/.zcode/v2/muse-code-sessions.json；env 覆盖供测试注入）。
// - 宽容读取：文件缺失/损坏/schema 不符 → 空映射（fail-open 读取、行为仍
//   fail-closed：映射缺失 = 每轮新会话，绝不虚构 id）。
// - 原子写入（atomicWritePrivateTextFile）；写入失败降级为「本轮不可续接」
//   （warn 由调用方记录），绝不阻断已完成的 turn 收口。
// - 条目上限 + 按 updatedAt 裁剪，避免无界增长。

/** 条目上限（超出时按 updatedAt 淘汰最旧）。 */
const MAX_SESSION_ENTRIES = 200;

export interface MuseSessionMapping {
  museSessionId: string;
  /** 建立映射时使用的执行面（诊断用）。 */
  surface: MuseExecutionSurface;
  /** 建立映射时的 workspace 根（resume 侧 workspace mismatch 的对账线索）。 */
  workspaceRoot: string;
  updatedAt: string;
}

export type MuseSessionMap = Record<string, MuseSessionMapping>;

export interface MuseSessionStore {
  read(): Promise<MuseSessionMap>;
  write(map: MuseSessionMap): Promise<void>;
}

/** 文件实现（缺省）；测试可注入内存实现。 */
export function createFileMuseSessionStore(env: NodeJS.ProcessEnv): MuseSessionStore {
  const filePath = resolveMuseCodeSessionsFilePath(env);
  return {
    async read(): Promise<MuseSessionMap> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        return sanitizeSessionMap(parsed);
      } catch {
        return {};
      }
    },
    async write(map: MuseSessionMap): Promise<void> {
      await atomicWritePrivateTextFile(filePath, `${JSON.stringify(map, null, 2)}\n`);
    },
  };
}

/** 宽容净化：只保留合法条目（未知字段丢弃，绝不透传进子进程环境）。 */
export function sanitizeSessionMap(parsed: unknown): MuseSessionMap {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: MuseSessionMap = {};
  const record = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (!key || key.length > 256 || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const museSessionId =
      typeof entry.museSessionId === "string" && entry.museSessionId.length > 0
        ? entry.museSessionId.slice(0, 256)
        : undefined;
    if (!museSessionId) continue;
    const surface: MuseExecutionSurface =
      entry.surface === "session-protocol" ? "session-protocol" : "muse-exec";
    const workspaceRoot =
      typeof entry.workspaceRoot === "string" ? entry.workspaceRoot.slice(0, 1024) : "";
    const updatedAt =
      typeof entry.updatedAt === "string" && entry.updatedAt.length > 0
        ? entry.updatedAt
        : new Date().toISOString();
    result[key] = { museSessionId, surface, workspaceRoot, updatedAt };
  }
  return result;
}

/** 记录映射（新建或刷新 updatedAt）；超限时先淘汰最旧条目。 */
export function recordMuseSessionMapping(
  map: MuseSessionMap,
  mosSessionId: string,
  mapping: Omit<MuseSessionMapping, "updatedAt">,
): MuseSessionMap {
  const next: MuseSessionMap = {
    ...map,
    [mosSessionId]: { ...mapping, updatedAt: new Date().toISOString() },
  };
  const entries = Object.entries(next);
  if (entries.length <= MAX_SESSION_ENTRIES) return next;
  const pruned = entries
    .sort((left, right) => (left[1].updatedAt < right[1].updatedAt ? -1 : 1))
    .slice(entries.length - MAX_SESSION_ENTRIES);
  return Object.fromEntries(pruned);
}

/**
 * 读取某 MOS 会话的既有映射（缺失 = undefined，不猜测）。resume 门控（评审
 * rev. 3）用完整条目：调用方必须比对条目的 workspaceRoot 与当前请求根
 * （isSameMuseWorkspaceRoot，词法 + realpath 别名解析）；不一致 = 不续接
 * （当前根内开新会话），绝不跨 workspace 边界续接。
 */
export function lookupMuseSessionMapping(
  map: MuseSessionMap,
  mosSessionId: string,
): MuseSessionMapping | undefined {
  return map[mosSessionId];
}
