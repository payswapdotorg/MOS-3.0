// fresh-install fixture 纯逻辑单测：线协议解析（oauth-wire）、产品归属裁决与授权状态
// 折叠（grant-wire）、全周期编排（cycle，注入 fetch/sleep/now，零网络）与证据脱敏。
// 与 release-smoke-lib.test.mjs 同纪律：node --test，无 npm 依赖，禁止网络/GUI。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildInitRequest,
  buildPollRequest,
  createPollToken,
  parseEnvelope,
  parseInitData,
  parsePollData,
} from "./lib/oauth-wire.mjs";
import {
  buildBillingBalanceUrl,
  buildClientConfigsUrl,
  buildEndpointHeaders,
  classifyGrantState,
  extractOwnedRecords,
  isStartPlanRecordOwnedByCurrentProduct,
} from "./lib/grant-wire.mjs";
import {
  INSTALLATION_SURFACES,
  finalVerdict,
  fingerprint,
  runFreshInstallCycle,
  VERDICT_EXIT_CODES,
} from "./lib/cycle.mjs";

// ── oauth-wire ───────────────────────────────────────────────────────────────

test("parseInitData：合法 init 载荷（真实 2026-11-15 线上形状）", () => {
  const data = parseInitData({
    flow_id: "flow-1",
    authorize_url: "https://chat.z.ai/api/oauth/authorize?x=1",
    expires_at: 1794761251,
    poll_interval_sec: 2,
    server_time: 1794761151,
  });
  assert.equal(data.flowId, "flow-1");
  assert.equal(data.pollIntervalSec, 2);
  assert.equal(data.serverTime, 1794761151);
});

test("parseInitData：缺字段 / 非 https authorize_url / poll_interval_sec<1 一律拒绝", () => {
  for (const bad of [
    { flow_id: "f", authorize_url: "https://a.b/c", expires_at: 1, poll_interval_sec: 0 },
    { flow_id: "f", authorize_url: "http://a.b/c", expires_at: 1, poll_interval_sec: 1 },
    { flow_id: "", authorize_url: "https://a.b/c", expires_at: 1, poll_interval_sec: 1 },
    { flow_id: "f", authorize_url: "https://a.b/c", expires_at: "soon", poll_interval_sec: 1 },
  ]) {
    assert.throws(() => parseInitData(bad), /Invalid OAuth/);
  }
});

test("parseEnvelope：code!==0 抛业务错误；缺 code 抛 envelope 错误", () => {
  assert.deepEqual(parseEnvelope(200, { code: 0, data: { a: 1 } }), { a: 1 });
  assert.throws(() => parseEnvelope(200, { code: 3006, msg: "denied" }), /denied/);
  assert.throws(() => parseEnvelope(200, { msg: "no code" }), /Invalid OAuth response envelope/);
});

test("parsePollData：pending / failed / ready（zai 家族取 data.zai）", () => {
  assert.deepEqual(parsePollData({ status: "pending" }, "zai"), { status: "pending" });
  assert.deepEqual(parsePollData({ status: "failed" }, "zai"), { status: "failed" });
  const ready = parsePollData(
    {
      status: "ready",
      token: "jwt-value",
      user: { user_id: "u-1", name: "n" },
      zai: { access_token: "at", refresh_token: "rt" },
    },
    "zai",
  );
  assert.equal(ready.token, "jwt-value");
  assert.equal(ready.user.user_id, "u-1");
  assert.equal(ready.accessToken, "at");
  assert.equal(ready.refreshToken, "rt");
  // bigmodel 家族从 data.bigmodel 取 access_token（驼峰兼容）。
  const bigmodel = parsePollData(
    {
      status: "ready",
      token: "jwt-value",
      user: { user_id: "u-2" },
      bigmodel: { accessToken: "at2" },
    },
    "bigmodel",
  );
  assert.equal(bigmodel.accessToken, "at2");
  assert.throws(() => parsePollData({ status: "weird" }, "zai"), /Invalid OAuth poll/);
});

test("请求描述符：init/poll 的 URL、方法与头（镜像 cli-oauth.ts）", () => {
  const init = buildInitRequest({
    origin: "https://zcode.z.ai/",
    providerId: "zai",
    pollToken: "tok",
    extraHeaders: { "X-ZCode-Product-Id": "mos" },
  });
  assert.equal(init.url, "https://zcode.z.ai/api/v1/oauth/cli/init");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer tok");
  assert.equal(init.headers["X-ZCode-Product-Id"], "mos");
  assert.deepEqual(JSON.parse(init.body), { provider: "zai" });

  const poll = buildPollRequest({ origin: "https://zcode.z.ai", flowId: "a/b c", pollToken: "tok" });
  assert.equal(poll.url, "https://zcode.z.ai/api/v1/oauth/cli/poll/a%2Fb%20c");
  assert.equal(poll.method, "GET");
});

test("createPollToken：256 位本地随机（不承载账号身份）", () => {
  const token = createPollToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(token, createPollToken());
});

// ── grant-wire ───────────────────────────────────────────────────────────────

test("isStartPlanRecordOwnedByCurrentProduct：移植矩阵（ACR-0001 P3）", () => {
  // 未声明归属 ⇒ 仅 zcode 可消费；mos 不得把共享配置推断为自己的权益。
  assert.equal(isStartPlanRecordOwnedByCurrentProduct(undefined, "zcode"), true);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct(null, "mos"), false);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct("", "mos"), false);
  // 声明归属 ⇒ 必须完全一致；未知/他产品一律拒绝。
  assert.equal(isStartPlanRecordOwnedByCurrentProduct("mos", "mos"), true);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct("zcode", "mos"), false);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct("mos", "zcode"), false);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct(" unknown ", "unknown"), true);
  // 非字符串值按“未声明归属”处理。
  assert.equal(isStartPlanRecordOwnedByCurrentProduct(42, "zcode"), true);
  assert.equal(isStartPlanRecordOwnedByCurrentProduct(42, "mos"), false);
});

test("extractOwnedRecords：configs 预览与 plans 记录都按产品裁决过滤", () => {
  const parsed = {
    data: {
      startPlanPreview: { planId: "p-mos", productId: "mos" },
      plans: [
        { plan_id: "legacy", product_id: null },
        { plan_id: "p-zcode", product_id: "zcode" },
        { plan_id: "p-mos", product_id: "mos", user_plan_id: "up-1", status: "active" },
      ],
    },
  };
  const owned = extractOwnedRecords(parsed, "mos");
  assert.equal(owned.length, 2);
  assert.ok(owned.every((record) => record.source !== undefined));
  // zcode 产品下：legacy（未声明）+ zcode 声明 + mos 预览不归属。
  const ownedZcode = extractOwnedRecords(parsed, "zcode");
  assert.equal(ownedZcode.length, 2);
});

test("classifyGrantState：401 ⇒ authentication-required（绝不折叠成确认缺失）", () => {
  const state = classifyGrantState({
    observations: [
      { kind: "billing-balance", ok: true, httpStatus: 401, businessCode: null, parsed: null },
    ],
    currentProductId: "mos",
  });
  assert.equal(state, "authentication-required");
});

test("classifyGrantState：传输失败 ⇒ unavailable；成功且无本产品 record ⇒ not-configured", () => {
  assert.equal(
    classifyGrantState({
      observations: [{ kind: "billing-balance", ok: false, httpStatus: 502, businessCode: null, parsed: {} }],
      currentProductId: "mos",
    }),
    "unavailable",
  );
  assert.equal(
    classifyGrantState({
      observations: [
        {
          kind: "client-configs",
          ok: true,
          httpStatus: 200,
          businessCode: 0,
          parsed: { code: 0, data: { startPlanPreview: null, plans: [{ product_id: "zcode" }] } },
        },
      ],
      currentProductId: "mos",
    }),
    "not-configured",
  );
});

test("classifyGrantState：本产品 active 记录 ⇒ active-grant；仅有可领取记录 ⇒ claimable", () => {
  const active = {
    kind: "billing-balance",
    ok: true,
    httpStatus: 200,
    businessCode: 0,
    parsed: {
      code: 0,
      data: { plans: [{ product_id: "mos", user_plan_id: "up-9", status: "active" }] },
    },
  };
  assert.equal(
    classifyGrantState({ observations: [active], currentProductId: "mos" }),
    "active-grant",
  );
  const claimable = {
    kind: "billing-preview",
    ok: true,
    httpStatus: 200,
    businessCode: 0,
    parsed: { code: 0, data: { plans: [{ product_id: "mos", plan_id: "free" }] } },
  };
  assert.equal(
    classifyGrantState({ observations: [claimable], currentProductId: "mos" }),
    "claimable",
  );
});

test("URL 构造：configs/preview 带 app_version+platform；balance 只带 app_version", () => {
  const base = { origin: "https://zcode.z.ai", appVersion: "3.18.0" };
  assert.equal(
    buildClientConfigsUrl({ ...base, platform: "win32-x64" }),
    "https://zcode.z.ai/api/v1/client/configs?app_version=3.18.0&platform=win32-x64",
  );
  assert.equal(
    buildBillingBalanceUrl(base),
    "https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.18.0",
  );
});

test("端点头：deviceMid 映射 X-Device-Mid（billing 必填参数）；缺省不发送", () => {
  const withDevice = buildEndpointHeaders({
    productId: "mos",
    appVersion: "3.18.0",
    platform: "linux-x64",
    deviceMid: "11111111-2222-3333-4444-555555555555",
    authorization: "Bearer jwt",
  });
  assert.equal(withDevice["X-Device-Mid"], "11111111-2222-3333-4444-555555555555");
  assert.equal(withDevice["X-ZCode-Product-Id"], "mos");
  assert.equal(withDevice.Authorization, "Bearer jwt");
  assert.equal(withDevice["User-Agent"], "ZCode/3.18.0");
  assert.equal(withDevice["X-Platform"], "linux-x64");
  const withoutDevice = buildEndpointHeaders({ productId: "mos", appVersion: "3.18.0" });
  assert.equal("X-Device-Mid" in withoutDevice, false);
});

// ── cycle 编排（注入 fetch/sleep/now）────────────────────────────────────────

function jsonResponse(status, payload) {
  return {
    status,
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
  };
}

function fakeTransport({ init, polls = [], grant = {}, catalogProbe }) {
  const calls = [];
  const fetchImpl = async (url, init2 = {}) => {
    const headers = init2.headers ?? {};
    calls.push({ url, method: init2.method, headers });
    if (url.endsWith("/oauth/cli/init")) {
      return jsonResponse(init?.status ?? 200, init?.payload);
    }
    if (url.includes("/oauth/cli/poll/")) {
      const next = polls.length > 1 ? polls.shift() : polls[0];
      return jsonResponse(next?.status ?? 200, next?.payload ?? { code: 0, data: { status: "pending" } });
    }
    const grantResponse = (entry) =>
      entry
        ? jsonResponse(entry.status ?? 200, entry.payload)
        : jsonResponse(200, { code: 0, data: {} });
    if (url.includes("/client/configs")) {
      if (headers["X-ZCode-Product-Id"] === "unknown-xyz") {
        return jsonResponse(catalogProbe?.status ?? 200, catalogProbe?.payload ?? { code: 0, data: {} });
      }
      return grantResponse(grant["client-configs"]);
    }
    if (url.includes("/billing/preview")) {
      return grantResponse(grant["billing-preview"]);
    }
    if (url.includes("/billing/balance")) {
      return grantResponse(grant["billing-balance"]);
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { fetchImpl, calls };
}

function fakeClock() {
  let value = 0;
  return {
    now: () => value,
    sleep: (ms) => {
      value += ms;
      return Promise.resolve();
    },
  };
}

const READY_PAYLOAD = {
  code: 0,
  data: {
    status: "ready",
    token: "SECRET-JWT-VALUE",
    user: { user_id: "SECRET-USER-ID" },
    zai: { access_token: "SECRET-ACCESS-TOKEN" },
  },
};

test("cycle：全周期 happy path —— 注册 → ready → 凭据落地 → active grant", async () => {
  const clock = fakeClock();
  const DEVICE_MID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const logs = [];
  const { fetchImpl, calls } = fakeTransport({
    init: {
      payload: {
        code: 0,
        data: {
          flow_id: "flow-1",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      },
    },
    polls: [{ payload: READY_PAYLOAD }],
    grant: {
      "billing-balance": {
        payload: {
          code: 0,
          data: { plans: [{ product_id: "mos", user_plan_id: "up-1", status: "active" }] },
        },
      },
    },
  });
  const evidence = await runFreshInstallCycle({
    dataRoot: mkdtempSync(join(tmpdir(), "fixture-test-")),
    consentWaitMs: 5000,
    deviceMid: DEVICE_MID,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    log: (line) => logs.push(line),
  });
  assert.equal(evidence.verdict, "full-cycle-verified");
  assert.equal(VERDICT_EXIT_CODES[evidence.verdict], 0);
  const legStatuses = Object.fromEntries(evidence.legs.map((leg) => [leg.leg, leg.status]));
  assert.equal(legStatuses["fresh-state"], "fresh");
  assert.equal(legStatuses.reset, "clean");
  assert.equal(legStatuses["live-registration"], "ok");
  assert.equal(legStatuses.consent, "consent-completed");
  assert.equal(legStatuses.credentials, "landed");
  assert.equal(legStatuses.grant, "active-grant");
  // 有人值守可用性：authorize_url 在 live registration 后立刻打印（等待期间可见）。
  const urlLogIndex = logs.findIndex((line) => line.includes("https://chat.z.ai/api/oauth/authorize"));
  const registrationLogIndex = logs.findIndex((line) => line.startsWith("[live-registration] ok"));
  const consentStatusIndex = logs.findIndex((line) => line.startsWith("[consent] consent-completed"));
  assert.ok(urlLogIndex > registrationLogIndex);
  assert.ok(urlLogIndex < consentStatusIndex);
  // 线保真：三个 grant 端点请求（含产品目录探针）都携带与真实客户端一致的 X-Device-Mid。
  const grantCalls = calls.filter(
    (call) =>
      call.url.includes("/client/configs") ||
      call.url.includes("/billing/preview") ||
      call.url.includes("/billing/balance"),
  );
  const probeCall = grantCalls.find((call) => call.headers["X-ZCode-Product-Id"] === "unknown-xyz");
  const realGrantCalls = grantCalls.filter(
    (call) => call.headers["X-ZCode-Product-Id"] !== "unknown-xyz",
  );
  assert.ok(realGrantCalls.length >= 3);
  for (const call of realGrantCalls) {
    assert.equal(call.headers["X-Device-Mid"], DEVICE_MID);
    assert.equal(call.headers["X-ZCode-Product-Id"], "mos");
    if (call.url.includes("/billing/balance")) {
      assert.equal(call.headers.Authorization, "Bearer SECRET-JWT-VALUE");
    }
  }
  // 无凭据的目录探针同样携带设备身份（镜像 NodeApiClient 注入），但不带 Authorization。
  assert.ok(probeCall);
  assert.equal(probeCall.headers["X-Device-Mid"], DEVICE_MID);
  assert.equal(probeCall.headers.Authorization, undefined);
  // 设备身份脱敏：证据只留指纹，绝不落原始 deviceMid（AGENTS.md §4 个人数据不入证据）。
  assert.equal(evidence.observations.deviceMidMode, "provided");
  assert.match(evidence.observations.deviceMidFingerprint, /^[0-9a-f]{12} \(len 36\)$/);
  // 脱敏：证据里不得出现任何原始 secret。
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes("SECRET-JWT-VALUE"));
  assert.ok(!serialized.includes("SECRET-USER-ID"));
  assert.ok(!serialized.includes("SECRET-ACCESS-TOKEN"));
  assert.ok(!serialized.includes(DEVICE_MID));
  assert.match(evidence.legs[4].jwtFingerprint, /^[0-9a-f]{12} \(len 16\)$/);
});

test("cycle：无人值守 —— consent 预算耗尽 ⇒ auth_timeout（预期终态，exit 3）", async () => {
  const clock = fakeClock();
  const logs = [];
  const { fetchImpl } = fakeTransport({
    init: {
      payload: {
        code: 0,
        data: {
          flow_id: "flow-2",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      },
    },
    polls: [],
    grant: {
      // 无凭据：balance 401（fail-closed），configs/preview 200 空。
      "client-configs": { payload: { code: 0, data: {} } },
      "billing-preview": { payload: { code: 0, data: { plans: [] } } },
      "billing-balance": { status: 401, payload: undefined },
    },
  });
  const evidence = await runFreshInstallCycle({
    dataRoot: mkdtempSync(join(tmpdir(), "fixture-test-")),
    consentWaitMs: 2000,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    log: (line) => logs.push(line),
  });
  assert.equal(evidence.verdict, "blocked-consent-timeout");
  assert.equal(VERDICT_EXIT_CODES[evidence.verdict], 3);
  const legStatuses = Object.fromEntries(evidence.legs.map((leg) => [leg.leg, leg.status]));
  assert.equal(legStatuses.consent, "auth_timeout");
  assert.equal(legStatuses.credentials, "not-reached");
  // grant 段的 401 观察被折叠为 authentication-required（不是确认缺失）。
  assert.equal(legStatuses.grant, "authentication-required");
  const balance = evidence.observations.grantEndpoints.find((o) => o.kind === "billing-balance");
  assert.equal(balance.httpStatus, 401);
  // 无人值守短预算：心跳不应触发（2s < 30s 心跳间隔）。
  const consentLeg = evidence.legs.find((leg) => leg.leg === "consent");
  assert.equal(consentLeg.heartbeats, undefined);
  assert.ok(!logs.some((line) => line.includes("budget left")));
});

test("cycle：等待心跳 —— 超过 30s 未授权时报告剩余预算，证据记录心跳数", async () => {
  const clock = fakeClock();
  const logs = [];
  const { fetchImpl } = fakeTransport({
    init: {
      payload: {
        code: 0,
        data: {
          flow_id: "flow-hb",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      },
    },
    polls: [],
    grant: {
      "client-configs": { payload: { code: 0, data: {} } },
      "billing-preview": { payload: { code: 0, data: { plans: [] } } },
      "billing-balance": { status: 401, payload: undefined },
    },
  });
  const evidence = await runFreshInstallCycle({
    dataRoot: mkdtempSync(join(tmpdir(), "fixture-test-")),
    consentWaitMs: 95_000,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    log: (line) => logs.push(line),
  });
  assert.equal(evidence.verdict, "blocked-consent-timeout");
  const consentLeg = evidence.legs.find((leg) => leg.leg === "consent");
  // 假时钟从 0 起跳：90s 预算里第 30/60/90 秒附近共 3 次心跳。
  assert.equal(consentLeg.heartbeats, 3);
  assert.ok(logs.some((line) => line.includes("budget left")));
});

test("cycle：轮询瞬时错误（5xx）按服务端间隔重试，随后 ready 仍成立", async () => {
  const clock = fakeClock();
  const polls = [];
  const fetchImpl = async (url) => {
    if (url.includes("/oauth/cli/poll/")) {
      const next = polls.shift();
      if (next?.networkError) throw new TypeError("fetch failed");
      return jsonResponse(next?.status ?? 200, next?.payload);
    }
    if (url.endsWith("/oauth/cli/init")) {
      return jsonResponse(200, {
        code: 0,
        data: {
          flow_id: "flow-4",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      });
    }
    return jsonResponse(200, { code: 0, data: {} });
  };
  polls.push({ status: 503, payload: undefined }, { networkError: true }, { payload: READY_PAYLOAD });
  const evidence = await runFreshInstallCycle({
    dataRoot: mkdtempSync(join(tmpdir(), "fixture-test-")),
    consentWaitMs: 10_000,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
  });
  const legStatuses = Object.fromEntries(evidence.legs.map((leg) => [leg.leg, leg.status]));
  assert.equal(legStatuses.consent, "consent-completed");
  assert.equal(legStatuses.credentials, "landed");
});

test("cycle：设备身份生成 —— 未注入 deviceMid 时每次运行独立生成（fresh 安装语义）", async () => {
  const clock = fakeClock();
  const makeTransport = () => fakeTransport({
    init: {
      payload: {
        code: 0,
        data: {
          flow_id: "flow-5",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      },
    },
    polls: [],
    grant: { "billing-balance": { status: 401, payload: undefined } },
  });
  const run = async () => {
    const transport = makeTransport();
    const evidence = await runFreshInstallCycle({
      dataRoot: mkdtempSync(join(tmpdir(), "fixture-test-")),
      consentWaitMs: 0,
      fetchImpl: transport.fetchImpl,
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
    });
    return { evidence, deviceMids: transport.calls.map((call) => call.headers["X-Device-Mid"]) };
  };
  const first = await run();
  const second = await run();
  assert.equal(first.evidence.observations.deviceMidMode, "generated-per-run");
  assert.ok(first.deviceMids.every((value) => typeof value === "string" && value.length === 36));
  // 同一周期内共用同一个 deviceMid；跨周期（fresh 安装）重新生成。
  assert.ok(new Set(first.deviceMids).size === 1);
  assert.ok(new Set(second.deviceMids).size === 1);
  assert.notEqual(first.deviceMids[0], second.deviceMids[0]);
});

test("cycle：reset 段清理已存在的安装面（reinstall 复验入口）", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "fixture-test-"));
  for (const surface of INSTALLATION_SURFACES) {
    const target = join(dataRoot, ...surface.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, "{}");
  }
  const clock = fakeClock();
  const { fetchImpl } = fakeTransport({
    init: {
      payload: {
        code: 0,
        data: {
          flow_id: "flow-3",
          authorize_url: "https://chat.z.ai/api/oauth/authorize",
          expires_at: 4000000000,
          poll_interval_sec: 1,
        },
      },
    },
    polls: [],
    grant: { "billing-balance": { status: 401, payload: undefined } },
  });
  const evidence = await runFreshInstallCycle({
    dataRoot,
    consentWaitMs: 0,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
  });
  const legStatuses = Object.fromEntries(evidence.legs.map((leg) => [leg.leg, leg.status]));
  assert.equal(legStatuses["fresh-state"], "dirty");
  assert.equal(legStatuses.reset, "clean");
  rmSync(dataRoot, { recursive: true, force: true });
});

test("finalVerdict：终态映射矩阵", () => {
  assert.equal(
    finalVerdict({ consentStatus: "consent-completed", grantState: "active-grant" }),
    "full-cycle-verified",
  );
  assert.equal(finalVerdict({ consentStatus: "auth_timeout", grantState: "not-configured" }), "blocked-consent-timeout");
  assert.equal(finalVerdict({ consentStatus: "consent-denied", grantState: "not-configured" }), "blocked-consent-denied");
  assert.equal(finalVerdict({ consentStatus: "auth-failed", grantState: "not-configured" }), "blocked-auth-failed");
  assert.equal(
    finalVerdict({ consentStatus: "consent-completed", grantState: "authentication-required" }),
    "blocked-authentication-required",
  );
  assert.equal(
    finalVerdict({ consentStatus: "consent-completed", grantState: "not-configured" }),
    "blocked-provider-not-configured",
  );
});

test("fingerprint：sha256 前 12 位 + 长度；空值返回 null", () => {
  assert.equal(fingerprint(null), null);
  assert.equal(fingerprint(""), null);
  assert.match(fingerprint("abc"), /^[0-9a-f]{12} \(len 3\)$/);
});
