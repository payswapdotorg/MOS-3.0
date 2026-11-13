/**
 * 可模仿的最小接线示例（contract.example.ts：只依赖公开入口）。
 * 真实栈组合（createRealStudioPorts + MCP server 入口）见 src/runtime/*（构建产物形态）。
 */
import { SystemTimePort } from "@mos/adapters";
import { StudioService } from "./application/studio-service.js";
import { runSessionStartHook } from "./hook/main.js";
import type { CredentialStorePort, StudioPorts } from "./application/studio-service.js";
import type { ProviderPort } from "@mos/adapters";

/** 内存凭据替身（工程测试形态；生产 = 真实共享 ZCode 凭据存储）。 */
export function exampleCredentialStore(initial: Record<string, string> = {}): CredentialStorePort {
  const values = new Map(Object.entries(initial));
  return {
    async save(key, value) {
      values.set(key, value);
    },
    async load(key) {
      return values.get(key) ?? null;
    },
  };
}

/** 结构化端口组合替身（真实栈见 src/runtime/real-stack.ts）。 */
export function exampleStudioPorts(
  createProviderPort: () => ProviderPort,
  credentialStore: CredentialStorePort,
): StudioPorts {
  return {
    createProviderPort,
    credentialStore,
    time: new SystemTimePort(),
    fetch: globalThis.fetch,
  };
}

/** 旅程最小接线：SessionStart hook → mission sidecar（graceful failure）。 */
export async function exampleHookWiring(stdinPayload: string, dataDir: string) {
  return runSessionStartHook(stdinPayload, { dataDir });
}

/** 服务最小构造（会话事实由每次工具调用的 _meta 提供）。 */
export function exampleStudioService(
  dataDir: string | null,
  ports: StudioPorts,
): StudioService {
  return new StudioService({ dataDir, ports });
}
