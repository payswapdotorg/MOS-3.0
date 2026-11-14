// Issue #24 §3：Muse CLI 状态 hook 的状态投影与可选服务守卫合同。
// 1) service 缺失 / 旧 Host double 不提供 getStatus 时不发起 RPC，折叠为 service_unavailable；
// 2) documented CLI 探测事实（未安装 / 已登录+额度 / 未登录 / 登录态未知）投影到对应 UI 阶段；
// 3) transport 抛错时只保留有界错误摘要（≤200 字符），不透传原始对象。
import { describe, expect, it } from "vitest";
import type { IMuseCliDetectionService, MuseCliStatus } from "@zcode/services";
import {
  boundMuseCliErrorText,
  loadMuseCliStatus,
  MUSE_CLI_SERVICE_UNAVAILABLE,
  MUSE_CLI_STATUS_UNRESOLVED,
  resolveMuseCliStatusState,
} from "../src/settings/model-provider-section/useMuseCliStatus.js";

/** 只实现 getStatus 的 service 桩；与 useStartPlanPreviewCache 测试同一 double 风格。 */
function createServiceStub(getStatus: () => Promise<MuseCliStatus>): IMuseCliDetectionService {
  return { getStatus } as unknown as IMuseCliDetectionService;
}

describe("resolveMuseCliStatusState（探测事实 → UI 阶段投影）", () => {
  it("无事实 → loading", () => {
    expect(resolveMuseCliStatusState(null, null)).toEqual({
      phase: "loading",
      status: null,
      error: null,
    });
  });

  it("transport 错误优先 → error 且不携带旧 status", () => {
    const stale: MuseCliStatus = { installed: true, signedIn: true };
    const state = resolveMuseCliStatusState(stale, "boom");
    expect(state.phase).toBe("error");
    expect(state.status).toBeNull();
    expect(state.error).toBe("boom");
  });

  it("未安装 → not-installed", () => {
    const state = resolveMuseCliStatusState({ installed: false }, null);
    expect(state.phase).toBe("not-installed");
    expect(state.status).toEqual({ installed: false });
    expect(state.error).toBeNull();
  });

  it("signedIn false → signed-out", () => {
    const state = resolveMuseCliStatusState({ installed: true, signedIn: false }, null);
    expect(state.phase).toBe("signed-out");
  });

  it("signedIn true → signed-in 且保留 usage 事实", () => {
    const status: MuseCliStatus = {
      installed: true,
      version: "1.2.3",
      signedIn: true,
      usage: { plan: "muse-pro", remaining: 12345 },
    };
    const state = resolveMuseCliStatusState(status, null);
    expect(state.phase).toBe("signed-in");
    expect(state.status).toEqual(status);
  });

  it("已安装但登录态未知 → error + 有界错误优先、缺省兜底码", () => {
    const withError = resolveMuseCliStatusState(
      { installed: true, error: "usage command timed out" },
      null,
    );
    expect(withError.phase).toBe("error");
    expect(withError.error).toBe("usage command timed out");

    const withoutError = resolveMuseCliStatusState({ installed: true, version: "1.2.3" }, null);
    expect(withoutError.phase).toBe("error");
    expect(withoutError.error).toBe(MUSE_CLI_STATUS_UNRESOLVED);
  });
});

describe("loadMuseCliStatus（可选能力守卫与 RPC 语义）", () => {
  it("service 缺失 → service_unavailable，不发起 RPC", async () => {
    const state = await loadMuseCliStatus(undefined);
    expect(state.phase).toBe("error");
    expect(state.error).toBe(MUSE_CLI_SERVICE_UNAVAILABLE);
  });

  it("service 不提供 getStatus（旧 Host double）→ service_unavailable", async () => {
    const state = await loadMuseCliStatus({} as IMuseCliDetectionService);
    expect(state.phase).toBe("error");
    expect(state.error).toBe(MUSE_CLI_SERVICE_UNAVAILABLE);
  });

  it("未安装探测 → not-installed 且保留 status 事实", async () => {
    const service = createServiceStub(async () => ({ installed: false }));
    const state = await loadMuseCliStatus(service);
    expect(state.phase).toBe("not-installed");
    expect(state.status).toEqual({ installed: false });
    expect(state.error).toBeNull();
  });

  it("已登录 + usage JSON → signed-in 且透传 usage（不发明字段）", async () => {
    const usage: Record<string, unknown> = {
      plan: "muse-max",
      allowance: "5x",
      resets_at: "2026-11-01",
    };
    const service = createServiceStub(async () => ({
      installed: true,
      version: "0.9.1",
      signedIn: true,
      usage,
    }));
    const state = await loadMuseCliStatus(service);
    expect(state.phase).toBe("signed-in");
    expect(state.status?.usage).toEqual(usage);
    expect(state.status?.version).toBe("0.9.1");
  });

  it("getStatus 抛错 → error 且错误摘要被截断到 200 字符内", async () => {
    const service = createServiceStub(() =>
      Promise.reject(new Error(`muse bridge failure: ${"x".repeat(500)}`)),
    );
    const state = await loadMuseCliStatus(service);
    expect(state.phase).toBe("error");
    expect(state.status).toBeNull();
    expect(state.error?.length ?? 0).toBeLessThanOrEqual(200);
    expect(state.error).toContain("…");
  });

  it("非 Error 抛出值 → 字符串化且折叠空白", async () => {
    const service = createServiceStub(() => Promise.reject("raw\n  failure"));
    const state = await loadMuseCliStatus(service);
    expect(state.phase).toBe("error");
    expect(state.error).toBe("raw failure");
  });

  it("空 message 的 Error → 回退到构造器名，不产出空文案", async () => {
    const service = createServiceStub(() => Promise.reject(new Error("")));
    const state = await loadMuseCliStatus(service);
    expect(state.phase).toBe("error");
    expect(state.error).toBe("Error");
  });
});

describe("boundMuseCliErrorText（卡片动作异常的有界摘要）", () => {
  it("startLogin / logout 抛出的超长异常 → 截断到 200 字符内", () => {
    const message = boundMuseCliErrorText(new Error(`muse login spawn failed: ${"y".repeat(400)}`));
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).toContain("…");
  });

  it("空摘要 → 稳定兜底码，不产出空文案", () => {
    expect(boundMuseCliErrorText("   ")).toBe(MUSE_CLI_STATUS_UNRESOLVED);
  });
});
