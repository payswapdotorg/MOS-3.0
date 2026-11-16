import type { ToolCallMeta } from "../contract/session-context.js";

/**
 * StudioService 与 LabDraftComposition 共享的会话事实形状与类型化错误
 * （拆分自 studio-service.ts —— 组合根两半区共享，避免相互导入形成环）。
 */

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

export class StudioEvidenceNotFoundError extends Error {
  readonly evidenceId: string;
  constructor(evidenceId: string) {
    super(`evidence not found: ${evidenceId}`);
    this.evidenceId = evidenceId;
    this.name = "StudioEvidenceNotFoundError";
  }
}

export class StudioNoteNotFoundError extends Error {
  readonly noteId: string;
  constructor(noteId: string) {
    super(`research note not found: ${noteId}`);
    this.noteId = noteId;
    this.name = "StudioNoteNotFoundError";
  }
}

export class StudioHypothesisNotFoundError extends Error {
  readonly hypothesisId: string;
  constructor(hypothesisId: string) {
    super(`hypothesis not found: ${hypothesisId}`);
    this.hypothesisId = hypothesisId;
    this.name = "StudioHypothesisNotFoundError";
  }
}

export class StudioBriefNotFoundError extends Error {
  readonly briefId: string;
  constructor(briefId: string) {
    super(`draft brief not found: ${briefId}`);
    this.briefId = briefId;
    this.name = "StudioBriefNotFoundError";
  }
}
