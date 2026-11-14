import { readFileSync } from "node:fs";
import { version as readOsVersion } from "node:os";
import { join } from "node:path";
import {
  buildZCodeSourceHeadersFromContext,
  normalizeZCodeSourceHeaderValue,
  ZCODE_ENV,
  ZCODE_SOURCE_HEADERS,
  ZCODE_VERSION,
  type ZCodeProductId,
} from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";

export { ZCODE_SOURCE_HEADERS };

interface ZCodeSourceHeaderOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  osVersion?: string;
  /** ACR-0001 P2：产品身份，缺省为构建期派生的 ZCODE_PRODUCT_ID（不可由用户偏好选择）。 */
  productId?: ZCodeProductId;
  platform?: NodeJS.Platform;
  releaseChannel?: string;
}

let cachedDeviceMid: { stateFile: string; value: string } | null = null;

function normalizePrintableHeaderValue(value: string | undefined): string | undefined {
  return normalizeZCodeSourceHeaderValue(value);
}

function resolveClientLanguage(): string {
  return normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().locale) ?? "unknown";
}

function resolveClientTimezone(): string {
  return (
    normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "unknown"
  );
}

function readExistingDeviceMid(): string | undefined {
  const stateFile = join(getAppConfigDir(), "telemetry-state.json");
  if (cachedDeviceMid?.stateFile === stateFile) {
    return cachedDeviceMid.value;
  }

  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as { deviceMid?: unknown };
    const deviceMid = normalizePrintableHeaderValue(
      typeof parsed.deviceMid === "string" ? parsed.deviceMid : undefined,
    );
    if (!deviceMid) {
      return undefined;
    }

    cachedDeviceMid = { stateFile, value: deviceMid };
    return deviceMid;
  } catch {
    // deviceMid 的生命周期由 desktop/telemetry 负责；这里仅复用已存在值，不生成新身份。
    return undefined;
  }
}

export function buildZCodeSourceHeaders(
  options: ZCodeSourceHeaderOptions = {},
): Record<string, string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const appVersion = normalizePrintableHeaderValue(options.appVersion ?? ZCODE_VERSION);
  const releaseChannel = normalizePrintableHeaderValue(options.releaseChannel ?? ZCODE_ENV);
  const clientLanguage =
    normalizePrintableHeaderValue(options.clientLanguage) ?? resolveClientLanguage();
  const clientTimezone =
    normalizePrintableHeaderValue(options.clientTimezone) ?? resolveClientTimezone();
  const osVersion = normalizePrintableHeaderValue(options.osVersion ?? readOsVersion());
  const deviceMid = readExistingDeviceMid();
  const productId = options.productId;

  return buildZCodeSourceHeadersFromContext({
    appVersion,
    arch,
    clientLanguage,
    clientTimezone,
    deviceMid,
    osVersion,
    ...(productId ? { productId } : {}),
    platform,
    releaseChannel,
    sourceTitle: "electron",
  });
}
