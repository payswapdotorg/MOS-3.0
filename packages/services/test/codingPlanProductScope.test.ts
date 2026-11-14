// Start Plan 产品范围合同测试（ACR-0001 / handoff §4 客户端可证子集）。
// 真实本地 HTTP mock 后端 + 真实 NodeApiClient（来源头注入）+ 真实 provider，
// 锁定 zcode / mos 两个产品在 preview、manual claim、balance、配置缓存、
// 余额缓存与请求头上的合同行为与 fail-closed 语义。
// 服务端合同见 docs/handoff/START-PLAN-PRODUCT-SCOPE-BACKEND-HANDOFF.md；
// mock 仅证明客户端合同（decision-lock §15：mocks 证明合同，不构成集成证据）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { ApiClient } from "@zcode/shared";
import {
  isRegisteredZCodeProductId,
  isStartPlanRecordOwnedByCurrentProduct,
  resolveZCodeProductId,
  ZCODE_PRODUCT_ID,
  type ZCodeProductId,
} from "@zcode/shared";

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

// ── mock 后端状态（用例逐段改写场景）──────────────────────────────────────────
const mockState = {
  configs: {
    code: 0,
    data: { configs: {} as Record<string, unknown> },
  },
  preview: {
    code: 0,
    data: { server_time: 100, plans: [] as Array<Record<string, unknown>> },
  },
  claim: {
    code: 0,
    data: { server_time: 100, plan: null as Record<string, unknown> | null },
  },
  balance: {
    code: 0,
    data: {
      server_time: 100,
      plans: [] as Array<Record<string, unknown>>,
      balances: [] as Array<Record<string, unknown>>,
    },
  },
  requests: {
    configs: [] as RecordedRequest[],
    preview: [] as RecordedRequest[],
    claim: [] as RecordedRequest[],
    balance: [] as RecordedRequest[],
  },
};

function resetMockState(): void {
  mockState.configs.data.configs = {};
  mockState.preview.data.plans = [];
  mockState.claim.data.plan = null;
  mockState.balance.data.plans = [];
  mockState.balance.data.balances = [];
  mockState.requests.configs = [];
  mockState.requests.preview = [];
  mockState.requests.claim = [];
  mockState.requests.balance = [];
}

function startPlanPreviewPayload(
  planId: string,
  options: { productId?: string } = {},
): Record<string, unknown> {
  return {
    planId,
    name: "Start Plan",
    entitlements: [
      {
        grantUnits: 100,
        meter: "request",
        period: "monthly",
        showName: "Free requests",
        unitType: "request",
      },
    ],
    ...(options.productId !== undefined ? { productId: options.productId } : {}),
  };
}

let server: Server;
let mockOrigin = "";
let currentProduct: ZCodeProductId = "zcode";

// ── 动态引入（env 指向 mock 后端后再加载模块；zaiStartPlanBilling 的余额 URL
//    是模块级常量，必须延迟到 env 就绪后 import）────────────────────────────
let NodeApiClientCtor: typeof import("../src/providers/api/nodeApiClient.js").NodeApiClient;
let BigModelCodingPlanSubscriptionProviderCtor: typeof import("../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js").BigModelCodingPlanSubscriptionProvider;
let fetchZaiStartPlanBalanceEnvelope: typeof import("../src/model-provider/zaiStartPlanBilling.js").fetchZaiStartPlanBalanceEnvelope;
let buildStartPlanAccountRequestAuthMaterial: typeof import("../src/model-provider/accountProviderRequestAuthService.js").buildStartPlanAccountRequestAuthMaterial;
let createAccountProviderRequestAuthService: typeof import("../src/model-provider/accountProviderRequestAuthService.js").createAccountProviderRequestAuthService;

function createProviderApiClient(): ApiClient {
  return new NodeApiClientCtor({
    resolveZCodeEndpointOrigin: () => mockOrigin,
    resolveProductId: () => currentProduct,
  });
}

function createProvider(): InstanceType<typeof BigModelCodingPlanSubscriptionProviderCtor> {
  return new BigModelCodingPlanSubscriptionProviderCtor({
    apiClient: createProviderApiClient(),
    loadOAuthAccountMaterial: async () => null,
    credentialService: {
      load: async (key: string) => (key === "zcodejwttoken" ? "test-zcode-jwt" : undefined),
    },
    resolveProductId: () => currentProduct,
  });
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => resolve(raw));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.local");
    const rawBody = req.method === "POST" ? await readRequestBody(req) : "";
    const record: RecordedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      headers: { ...req.headers } as Record<string, string>,
      ...(rawBody ? { body: JSON.parse(rawBody) as unknown } : {}),
    };
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/v1/client/configs") {
      mockState.requests.configs.push(record);
      res.end(JSON.stringify(mockState.configs));
      return;
    }
    if (url.pathname === "/api/v1/zcode-plan/billing/preview") {
      mockState.requests.preview.push(record);
      res.end(JSON.stringify(mockState.preview));
      return;
    }
    if (url.pathname === "/api/v1/zcode-plan/billing/claim") {
      mockState.requests.claim.push(record);
      res.end(JSON.stringify(mockState.claim));
      return;
    }
    if (url.pathname === "/api/v1/zcode-plan/billing/balance") {
      mockState.requests.balance.push(record);
      res.end(JSON.stringify(mockState.balance));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 404, msg: "not found" }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not return a port");
  }
  mockOrigin = `http://127.0.0.1:${address.port}`;
  // endpoint 解析在调用期读取 env（ZCODE_BASE_URL 优先）；先就绪再动态加载被测模块。
  process.env.ZCODE_BASE_URL = mockOrigin;
  process.env.ZCODE_ENDPOINT_ORIGIN = mockOrigin;
  process.env.ZCODE_TEST_BASE_URL = mockOrigin;
  const nodeApiClientModule = await import("../src/providers/api/nodeApiClient.js");
  NodeApiClientCtor = nodeApiClientModule.NodeApiClient;
  const providerModule = await import(
    "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js"
  );
  BigModelCodingPlanSubscriptionProviderCtor =
    providerModule.BigModelCodingPlanSubscriptionProvider;
  const billingModule = await import("../src/model-provider/zaiStartPlanBilling.js");
  fetchZaiStartPlanBalanceEnvelope = billingModule.fetchZaiStartPlanBalanceEnvelope;
  const authServiceModule = await import(
    "../src/model-provider/accountProviderRequestAuthService.js"
  );
  buildStartPlanAccountRequestAuthMaterial =
    authServiceModule.buildStartPlanAccountRequestAuthMaterial;
  createAccountProviderRequestAuthService =
    authServiceModule.createAccountProviderRequestAuthService;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
    setTimeout(() => reject(new Error("mock server close timeout")), 2000);
  });
});

beforeEach(() => {
  resetMockState();
  currentProduct = "zcode";
});

describe("产品身份派生（ACR-0001 P1）", () => {
  it("mos flavor → mos；其余 flavor / 未注入 → zcode（默认产品保持上游行为）", () => {
    expect(resolveZCodeProductId("mos")).toBe("mos");
    expect(resolveZCodeProductId("production")).toBe("zcode");
    expect(resolveZCodeProductId("preview")).toBe("zcode");
    expect(isRegisteredZCodeProductId("zcode")).toBe(true);
    expect(isRegisteredZCodeProductId("mos")).toBe(true);
    expect(isRegisteredZCodeProductId("garbage")).toBe(false);
    expect(isRegisteredZCodeProductId(undefined)).toBe(false);
    // 测试包未注入 flavor define —— 默认产品必须是 zcode（ACR-0001 兼容前提）。
    expect(ZCODE_PRODUCT_ID).toBe("zcode");
  });
});

describe("记录归属裁决矩阵（ACR-0001 P3）", () => {
  it("声明归属必须精确匹配；缺省只对 zcode 可消费；未知 id 一律拒绝", () => {
    expect(isStartPlanRecordOwnedByCurrentProduct(undefined, "zcode")).toBe(true);
    expect(isStartPlanRecordOwnedByCurrentProduct(undefined, "mos")).toBe(false);
    expect(isStartPlanRecordOwnedByCurrentProduct("", "zcode")).toBe(true);
    expect(isStartPlanRecordOwnedByCurrentProduct("", "mos")).toBe(false);
    expect(isStartPlanRecordOwnedByCurrentProduct("zcode", "zcode")).toBe(true);
    expect(isStartPlanRecordOwnedByCurrentProduct("mos", "mos")).toBe(true);
    expect(isStartPlanRecordOwnedByCurrentProduct("zcode", "mos")).toBe(false);
    expect(isStartPlanRecordOwnedByCurrentProduct("mos", "zcode")).toBe(false);
    expect(isStartPlanRecordOwnedByCurrentProduct("garbage", "zcode")).toBe(false);
    expect(isStartPlanRecordOwnedByCurrentProduct("garbage", "mos")).toBe(false);
    // 非字符串运行时值按“未声明归属”处理，不做任何推断。
    expect(isStartPlanRecordOwnedByCurrentProduct(123, "zcode")).toBe(true);
    expect(isStartPlanRecordOwnedByCurrentProduct(123, "mos")).toBe(false);
  });
});

describe("zcode 产品 × 旧后端（无 product 字段）—— 兼容保持", () => {
  it("无归属预览/可领计划照常可见；claim body 与现状字节一致（无 product_id）", async () => {
    mockState.configs.data.configs = {
      startPlanPreview: startPlanPreviewPayload("zcode-v3-start-plan"),
    };
    mockState.preview.data.plans = [
      {
        plan_id: "zcode-v3-start-plan",
        name: "ZCode V3 Start Plan",
        entitlements: [],
      },
    ];
    mockState.claim.data.plan = {
      user_plan_id: "up-1",
      plan_id: "zcode-v3-start-plan",
      status: "active",
    };

    const provider = createProvider();
    const preview = await provider.getStartPlanPreview();
    expect(preview?.planId).toBe("zcode-v3-start-plan");
    expect(preview?.productId).toBeUndefined();

    const previews = await provider.getManualClaimPlanPreviews();
    expect(previews.plans.map((plan) => plan.planId)).toEqual(["zcode-v3-start-plan"]);

    const claim = await provider.claimManualPlan({ planId: "zcode-v3-start-plan" });
    expect(claim.success).toBe(true);
    expect(claim.plan?.productId).toBeUndefined();
    // zcode 的 claim 请求体必须保持与现状完全一致（零回归前提）。
    expect(mockState.requests.claim[0]?.body).toEqual({ plan_id: "zcode-v3-start-plan" });
  });

  it("所有 endpoint 请求都带 X-ZCode-Product-Id: zcode 来源头（NodeApiClient 注入）", async () => {
    mockState.configs.data.configs = {};
    const provider = createProvider();
    await provider.getStartPlanPreview();
    await provider.getManualClaimPlanPreviews();
    await provider.claimManualPlan({ planId: "any-plan" });
    await fetchZaiStartPlanBalanceEnvelope(
      createProviderApiClient(),
      "Bearer test-zcode-jwt",
      false,
      { productId: "zcode" },
    );

    const allRequests = [
      ...mockState.requests.configs,
      ...mockState.requests.preview,
      ...mockState.requests.claim,
      ...mockState.requests.balance,
    ];
    expect(allRequests.length).toBeGreaterThanOrEqual(4);
    for (const request of allRequests) {
      expect(request.headers["x-zcode-product-id"]).toBe("zcode");
    }
  });
});

describe("mos 产品 × 旧后端（无 product 字段）—— fail-closed", () => {
  it("不因 zcode 预览存在而推断 mos 有 grant；可领计划为空", async () => {
    currentProduct = "mos";
    mockState.configs.data.configs = {
      startPlanPreview: startPlanPreviewPayload("zcode-v3-start-plan"),
    };
    mockState.preview.data.plans = [
      { plan_id: "zcode-v3-start-plan", name: "ZCode V3 Start Plan", entitlements: [] },
    ];

    const provider = createProvider();
    expect(await provider.getStartPlanPreview()).toBeNull();
    const previews = await provider.getManualClaimPlanPreviews();
    expect(previews.plans).toEqual([]);
    // 请求仍带 mos 产品头（product-aware 后端可据此返回 mos 配置）。
    expect(mockState.requests.configs[0]?.headers["x-zcode-product-id"]).toBe("mos");
    expect(mockState.requests.preview[0]?.headers["x-zcode-product-id"]).toBe("mos");
  });

  it("balance 过滤掉未声明归属的 plan 及其余额桶；无归属桶保留（诊断语义）", async () => {
    mockState.balance.data.plans = [
      {
        user_plan_id: "up-1",
        plan_id: "zcode-v3-start-plan",
        name: "ZCode V3 Start Plan",
        status: "active",
      },
    ];
    mockState.balance.data.balances = [
      {
        user_plan_id: "up-1",
        plan_id: "zcode-v3-start-plan",
        show_name: "ZCode free requests",
        available_units: 42,
      },
      {
        user_plan_id: "unattached",
        plan_id: "unknown-bucket",
        show_name: "Unattributed bucket",
        available_units: 1,
      },
    ];

    const envelope = await fetchZaiStartPlanBalanceEnvelope(
      createProviderApiClient(),
      "Bearer test-zcode-jwt",
      false,
      { productId: "mos" },
    );
    // mos 消费旧后端共享配置：plan 全部丢弃（上层判 coding_plan_not_entitled / no_plan）。
    expect(envelope.data?.plans).toEqual([]);
    // 依附于被丢弃 plan 的余额桶一并丢弃；从未归属任何 plan 的桶保留。
    expect(envelope.data?.balances?.map((entry) => entry.user_plan_id)).toEqual([
      "unattached",
    ]);
  });
});

describe("mos 产品 × product-aware 后端 —— 独立领取与余额", () => {
  it("mos 归属的预览可消费；claim body 显式携带 product_id: mos", async () => {
    currentProduct = "mos";
    mockState.configs.data.configs = {
      startPlanPreview: startPlanPreviewPayload("mos-v3-start-plan", { productId: "mos" }),
    };
    mockState.preview.data.plans = [
      {
        plan_id: "mos-v3-start-plan",
        product_id: "mos",
        name: "MOS Start Plan",
        entitlements: [],
      },
    ];
    mockState.claim.data.plan = {
      user_plan_id: "up-mos-1",
      plan_id: "mos-v3-start-plan",
      product_id: "mos",
      status: "active",
    };

    const provider = createProvider();
    const preview = await provider.getStartPlanPreview();
    expect(preview?.planId).toBe("mos-v3-start-plan");
    expect(preview?.productId).toBe("mos");

    const previews = await provider.getManualClaimPlanPreviews();
    expect(previews.plans.map((plan) => plan.planId)).toEqual(["mos-v3-start-plan"]);
    expect(previews.plans[0]?.productId).toBe("mos");

    const claim = await provider.claimManualPlan({ planId: "mos-v3-start-plan" });
    expect(claim.success).toBe(true);
    expect(claim.plan?.productId).toBe("mos");
    expect(mockState.requests.claim[0]?.body).toEqual({
      plan_id: "mos-v3-start-plan",
      product_id: "mos",
    });
  });

  it("balance 只保留 mos 归属 plan；zcode 归属 plan 及其余额桶丢弃", async () => {
    mockState.balance.data.plans = [
      {
        user_plan_id: "up-zcode-1",
        plan_id: "zcode-v3-start-plan",
        product_id: "zcode",
        name: "ZCode V3 Start Plan",
        status: "active",
      },
      {
        user_plan_id: "up-mos-1",
        plan_id: "mos-v3-start-plan",
        product_id: "mos",
        name: "MOS Start Plan",
        status: "active",
      },
    ];
    mockState.balance.data.balances = [
      {
        user_plan_id: "up-zcode-1",
        plan_id: "zcode-v3-start-plan",
        available_units: 99,
      },
      {
        user_plan_id: "up-mos-1",
        plan_id: "mos-v3-start-plan",
        available_units: 77,
      },
    ];

    const envelope = await fetchZaiStartPlanBalanceEnvelope(
      createProviderApiClient(),
      "Bearer test-zcode-jwt",
      false,
      { productId: "mos" },
    );
    expect(envelope.data?.plans.map((plan) => plan.plan_id)).toEqual([
      "mos-v3-start-plan",
    ]);
    expect(
      envelope.data?.balances?.map((entry) => entry.user_plan_id),
    ).toEqual(["up-mos-1"]);
  });

  it("同账号下 zcode 余额读只返回 zcode 归属 plan（双向隔离）", async () => {
    mockState.balance.data.plans = [
      {
        user_plan_id: "up-zcode-1",
        plan_id: "zcode-v3-start-plan",
        product_id: "zcode",
        status: "active",
      },
      {
        user_plan_id: "up-mos-1",
        plan_id: "mos-v3-start-plan",
        product_id: "mos",
        status: "active",
      },
    ];

    const envelope = await fetchZaiStartPlanBalanceEnvelope(
      createProviderApiClient(),
      "Bearer test-zcode-jwt",
      false,
      { productId: "zcode" },
    );
    expect(envelope.data?.plans.map((plan) => plan.plan_id)).toEqual([
      "zcode-v3-start-plan",
    ]);
  });
});

describe("跨产品与未知产品 —— 一律拒绝", () => {
  it("zcode 产品不消费 mos 归属的预览与可领计划", async () => {
    mockState.configs.data.configs = {
      startPlanPreview: startPlanPreviewPayload("mos-v3-start-plan", { productId: "mos" }),
    };
    mockState.preview.data.plans = [
      { plan_id: "mos-v3-start-plan", product_id: "mos", name: "MOS Start Plan" },
    ];

    const provider = createProvider();
    expect(await provider.getStartPlanPreview()).toBeNull();
    const previews = await provider.getManualClaimPlanPreviews();
    expect(previews.plans).toEqual([]);
  });

  it("未知产品 id 的响应记录对两个产品都拒绝（fail-closed）", async () => {
    mockState.configs.data.configs = {
      startPlanPreview: startPlanPreviewPayload("mystery-plan", { productId: "garbage" }),
    };
    mockState.preview.data.plans = [
      { plan_id: "mystery-plan", product_id: "garbage", name: "Mystery Plan" },
    ];

    for (const productId of ["zcode", "mos"] as const) {
      resetMockState();
      currentProduct = productId;
      mockState.configs.data.configs = {
        startPlanPreview: startPlanPreviewPayload("mystery-plan", { productId: "garbage" }),
      };
      mockState.preview.data.plans = [
        { plan_id: "mystery-plan", product_id: "garbage", name: "Mystery Plan" },
      ];
      const provider = createProvider();
      expect(await provider.getStartPlanPreview()).toBeNull();
      expect((await provider.getManualClaimPlanPreviews()).plans).toEqual([]);
    }
  });

  it("claim 结果声明他产品归属时按失败处理，不展示为领取成功", async () => {
    currentProduct = "mos";
    mockState.claim.code = 0;
    mockState.claim.data.plan = {
      user_plan_id: "up-zcode-1",
      plan_id: "zcode-v3-start-plan",
      product_id: "zcode",
      status: "active",
    };

    const provider = createProvider();
    const claim = await provider.claimManualPlan({ planId: "zcode-v3-start-plan" });
    expect(claim.success).toBe(false);
    expect(claim.message).toBe("start_plan_product_scope_mismatch");
  });
});

describe("缓存身份含产品范围（ACR-0001 P4）", () => {
  it("client/configs 缓存键含产品：同产品同身份命中缓存；产品切换重新拉取（单槽身份缓存，绝不互读）", async () => {
    mockState.configs.data.configs = {};
    const provider = createProvider();

    currentProduct = "zcode";
    await provider.getStartPlanPreview();
    expect(mockState.requests.configs.length).toBe(1);

    // 同产品同身份：60 分钟 TTL 内命中缓存，不重复请求。
    await provider.getStartPlanPreview();
    expect(mockState.requests.configs.length).toBe(1);

    // 切换产品（同一 URL、同一 JWT）：缓存键不同 → 与换号一样重新请求。
    currentProduct = "mos";
    await provider.getStartPlanPreview();
    expect(mockState.requests.configs.length).toBe(2);
    expect(mockState.requests.configs[1]?.headers["x-zcode-product-id"]).toBe("mos");

    // 切回 zcode：单槽缓存被 mos 上下文取代 → 再次拉取（mos 的快照不会作为 zcode 配置返回）。
    currentProduct = "zcode";
    await provider.getStartPlanPreview();
    expect(mockState.requests.configs.length).toBe(3);
    expect(mockState.requests.configs[2]?.headers["x-zcode-product-id"]).toBe("zcode");
  });

  it("balance 请求去重键含产品：同产品复用保留响应，跨产品各自请求", async () => {
    const apiClient = createProviderApiClient();
    const authorization = "Bearer test-zcode-jwt";

    await fetchZaiStartPlanBalanceEnvelope(apiClient, authorization, false, {
      productId: "zcode",
    });
    expect(mockState.requests.balance.length).toBe(1);

    // 同产品：保留窗口内复用响应（不重复打 balance）。
    await fetchZaiStartPlanBalanceEnvelope(apiClient, authorization, false, {
      productId: "zcode",
    });
    expect(mockState.requests.balance.length).toBe(1);

    // 跨产品：键不同 → 新请求。
    await fetchZaiStartPlanBalanceEnvelope(apiClient, authorization, false, {
      productId: "mos",
    });
    expect(mockState.requests.balance.length).toBe(2);

    await fetchZaiStartPlanBalanceEnvelope(apiClient, authorization, false, {
      productId: "mos",
    });
    expect(mockState.requests.balance.length).toBe(2);
  });
});

describe("Start Plan 模型面请求材料（ACR-0001 P2：用量记入正确产品配额）", () => {
  it("请求材料携带 X-ZCode-Product-Id；默认当前产品，可由 composition 注入", () => {
    const zcodeMaterial = buildStartPlanAccountRequestAuthMaterial("jwt-token");
    expect(zcodeMaterial.apiKey).toBe("jwt-token");
    expect(zcodeMaterial.headers?.["X-ZCode-Product-Id"]).toBe("zcode");

    const mosMaterial = buildStartPlanAccountRequestAuthMaterial("jwt-token", "mos");
    expect(mosMaterial.headers?.["X-ZCode-Product-Id"]).toBe("mos");
  });

  it("resolveCurrent 对 start-plan 账号返回携带产品头的材料", async () => {
    const service = createAccountProviderRequestAuthService({
      resolveCurrentAccountAccess: async () => null,
      loadOAuthTokenSet: async () => ({ zcodeJwtToken: "test-zcode-jwt" }),
      loadIndividualPlanMaterial: async () => null,
      resolveTeamPlanMaterial: async () => null,
    });
    const material = await service.resolveCurrent({
      providerId: "account:zai-start-plan",
      accountAccess: { type: "zhipu-account", family: "zai", planKind: "start-plan" },
      reason: "usage",
    });
    expect(material.apiKey).toBe("test-zcode-jwt");
    expect(material.headers?.["X-ZCode-Product-Id"]).toBe("zcode");
  });
});
