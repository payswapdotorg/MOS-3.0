// 委托 Muse Code 执行后端的 renderer 侧状态（Issue #24 / ACR-0002）。
//
// 双门控纪律（禁止静默改道）：
// - enabled：用户意图（Host 侧 IMuseCodeService 设置的镜像；localStorage 便于冷启动前读）。
// - supported：本进程会话内由 CLI 能力（runtime/capabilities.executionBackendMuseCode
//   → IMuseCodeService.getView().backendSupported）确认后置位；跨会话不持久化，
//   每次启动必须重新确认，防止 CLI 降级后旧标记导致信封字段被旧 CLI 静默剥掉。
// - 只有 enabled && supported 同时成立，createCommandEnvelope 才在
//   createSession / sendText 信封上携带 executionBackend: "muse-code"。

const MUSE_CODE_BACKEND_ENABLED_STORAGE_KEY = "zcode-muse-code-backend-enabled:v1";

export interface MuseCodeBackendState {
  enabled: boolean;
  supported: boolean;
}

let state: MuseCodeBackendState = { enabled: false, supported: false };
const listeners = new Set<() => void>();

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(MUSE_CODE_BACKEND_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(MUSE_CODE_BACKEND_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // 无 storage 环境（测试/隐身）只在进程内生效。
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** 进程内冷启动：恢复用户意图；supported 恒从 false 重新确认。 */
export function initMuseCodeBackendState(): void {
  const enabled = readStoredEnabled();
  if (state.enabled !== enabled) {
    state = { ...state, enabled };
    notify();
  }
}

export function getMuseCodeBackendState(): MuseCodeBackendState {
  return state;
}

export function setMuseCodeBackendEnabled(enabled: boolean): void {
  persistEnabled(enabled);
  if (state.enabled !== enabled) {
    state = { ...state, enabled };
    notify();
  }
}

export function setMuseCodeBackendSupported(supported: boolean): void {
  if (state.supported !== supported) {
    state = { ...state, supported };
    notify();
  }
}

/** 信封携带条件（commandFactory 消费）：双门控同时成立。 */
export function shouldStampMuseCodeExecutionBackend(): boolean {
  return state.enabled && state.supported;
}

export function subscribeMuseCodeBackendState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
