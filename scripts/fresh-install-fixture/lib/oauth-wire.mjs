// fresh-install fixture —— OAuth 轮询登录的线协议（init/poll）。
//
// 这是 `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts` 的同契约移植：
// 相同的 endpoint、请求形状与响应校验（envelope code===0、https authorize_url、
// poll_interval_sec>=1、ready 载荷里的 token/user_id/access_token）。fixture 驱动器
// 用它在隔离数据根上重放「注册 → 等待人工授权」两段；任何响应形状偏差都会在这里
// 显式失败，而不是被静默吞掉。
//
// 本模块只做请求描述符与响应解析（纯函数）；网络由调用方注入，便于单测。

import { randomBytes } from "node:crypto";

export const POLL_TOKEN_BYTES = 32;

export class CliOAuthWireError extends Error {
  businessCode;
  httpStatus;

  constructor(message, details = {}) {
    super(message);
    this.name = "CliOAuthWireError";
    this.businessCode = details.businessCode;
    this.httpStatus = details.httpStatus;
  }
}

/** 与 createCliOAuthPollToken() 一致：本地随机轮询令牌，不承载任何账号身份。 */
export function createPollToken() {
  return randomBytes(POLL_TOKEN_BYTES).toString("hex");
}

/** POST {origin}/api/v1/oauth/cli/init 的请求描述符（镜像 cli-oauth.ts init()）。 */
export function buildInitRequest({ origin, providerId, pollToken, extraHeaders = {} }) {
  return {
    url: `${normalizeBaseUrl(origin)}/api/v1/oauth/cli/init`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${pollToken}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({ provider: providerId }),
  };
}

/** GET {origin}/api/v1/oauth/cli/poll/{flowId} 的请求描述符（镜像 cli-oauth.ts poll()）。 */
export function buildPollRequest({ origin, flowId, pollToken, extraHeaders = {} }) {
  return {
    url: `${normalizeBaseUrl(origin)}/api/v1/oauth/cli/poll/${encodeURIComponent(flowId)}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${pollToken}`,
      ...extraHeaders,
    },
  };
}

/** 解析外层 envelope {code,msg,data}；code!==0 视为业务错误（镜像 requestJsonEnvelope）。 */
export function parseEnvelope(httpStatus, parsed) {
  if (typeof parsed?.code !== "number") {
    throw new CliOAuthWireError("Invalid OAuth response envelope", { httpStatus });
  }
  if (parsed.code !== 0) {
    throw new CliOAuthWireError(
      typeof parsed.msg === "string" && parsed.msg ? parsed.msg : `OAuth business error ${parsed.code}`,
      { businessCode: parsed.code, httpStatus },
    );
  }
  return parsed.data;
}

/** 校验 init data（镜像 parseInitData：flow_id/https authorize_url/expires_at/poll_interval_sec）。 */
export function parseInitData(value) {
  const data = asRecord(value);
  if (
    !data ||
    !readString(data.flow_id) ||
    !readString(data.authorize_url) ||
    typeof data.expires_at !== "number" ||
    !Number.isFinite(data.expires_at) ||
    typeof data.poll_interval_sec !== "number" ||
    !Number.isFinite(data.poll_interval_sec) ||
    data.poll_interval_sec < 1
  ) {
    throw new CliOAuthWireError("Invalid OAuth init response data");
  }
  try {
    if (new URL(readString(data.authorize_url)).protocol !== "https:") throw new Error();
  } catch {
    throw new CliOAuthWireError("Invalid OAuth authorization URL");
  }
  return {
    authorizeUrl: readString(data.authorize_url),
    expiresAt: data.expires_at,
    flowId: readString(data.flow_id),
    pollIntervalSec: data.poll_interval_sec,
    ...(typeof data.server_time === "number" ? { serverTime: data.server_time } : {}),
  };
}

/** 校验 poll data（镜像 parsePollData/parseReadyData：pending/failed/ready）。 */
export function parsePollData(value, providerId) {
  const data = asRecord(value);
  const status = data?.status;
  if (status === "pending" || status === "failed") {
    return { status };
  }
  if (status === "ready" && data) {
    return parseReadyData(data, providerId);
  }
  throw new CliOAuthWireError("Invalid OAuth poll response data");
}

function parseReadyData(data, providerId) {
  const user = asRecord(data.user);
  const provider = asRecord(data[providerId]);
  const accessToken = readString(provider?.access_token) ?? readString(provider?.accessToken);
  const refreshToken = readString(provider?.refresh_token) ?? readString(provider?.refreshToken);
  if (!readString(data.token) || !user || !readString(user.user_id) || !accessToken) {
    throw new CliOAuthWireError("Invalid OAuth ready response data");
  }
  return {
    status: "ready",
    token: readString(data.token),
    user: {
      ...(typeof user.avatar === "string" ? { avatar: user.avatar } : {}),
      ...(typeof user.email === "string" ? { email: user.email } : {}),
      ...(typeof user.name === "string" ? { name: user.name } : {}),
      user_id: readString(user.user_id),
    },
    providerId,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/u, "");
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
