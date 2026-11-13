/**
 * MOS 版本与发布标签解析。
 *
 * 约束来源 spec/backlog/release-engineering.md §1.3、§3：
 * - MOS 发布标签独立命名空间：`mos-v<semver>`（如 mos-v3.0.0-rc.1），绝不与上游 ZCode 的
 *   `v3.18.x` 标签形态重叠；上游基线版本另记录在 release manifest 的 zcodeBaseline。
 * - 版本必须是严格 semver（允许预发布段），MOS 发布版本与导入的 ZCode 版本互相独立。
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MOS_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const MOS_TAG_PREFIX = "mos-v";
export const MOS_TAG_PATTERN = /^mos-v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// 上游 ZCode 的发布标签是裸 `v<semver>` 形态（v3.18.x）。该形态在 MOS 发布链路中一律拒绝，
// 防止把上游标签误当成 MOS 标签发布（见 FINAL-TL-HANDOFF-DISTRIBUTABLE-RELEASE.md §4）。
const UPSTREAM_TAG_PATTERN = /^v\d+\.\d+\.\d+/;

/**
 * 解析 MOS 版本输入。接受裸版本（`3.0.0-rc.1`）或带 `mos-v` 前缀的标签（`mos-v3.0.0-rc.1`）。
 * 其它输入（含上游形态 `v3.18.0`、非 semver、裸 `v` 前缀）直接抛错。
 */
export function parseMosVersion(input) {
  if (typeof input !== "string") {
    throw new Error(`MOS 版本必须是字符串：${String(input)}`);
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error("MOS 版本不能为空");
  if (UPSTREAM_TAG_PATTERN.test(trimmed)) {
    throw new Error(
      `输入 ${trimmed} 是上游 ZCode 标签形态（v<semver>）；MOS 发布标签必须使用 ${MOS_TAG_PREFIX}<semver>`,
    );
  }
  let version = trimmed;
  if (version.startsWith(MOS_TAG_PREFIX)) version = version.slice(MOS_TAG_PREFIX.length);
  else if (version.startsWith("v")) throw new Error(`MOS 版本不接受裸 v 前缀：${trimmed}`);
  if (!MOS_VERSION_PATTERN.test(version)) {
    throw new Error(`MOS 版本不合法（期望 semver，如 3.0.0-rc.1）：${trimmed}`);
  }
  return { version, tag: `${MOS_TAG_PREFIX}${version}` };
}

/**
 * 是否发布候选（含预发布段）。仅对已通过 parseMosVersion 的版本做判定；
 * 不做 semver 解析，非版本输入的返回值不属于契约。
 */
export function isReleaseCandidate(version) {
  return typeof version === "string" && /-[0-9A-Za-z.-]+$/.test(version.trim());
}

/** MOS 发布通道：预发布段 → "rc"，否则 "stable"。 */
export function releaseChannelForVersion(version) {
  return isReleaseCandidate(version) ? "rc" : "stable";
}

/**
 * 断言标签属于 MOS 命名空间（`mos-v<semver>`）。非 mos-v 形态（含上游 `v3.18.x`）抛错。
 * 返回解析结果 { version, tag }；release-gate 与发布 job 共用。
 */
export function assertTagIsMosOwned(tag) {
  if (typeof tag !== "string" || !MOS_TAG_PATTERN.test(tag.trim())) {
    throw new Error(`标签 ${String(tag)} 不是 MOS 发布标签（期望 ${MOS_TAG_PREFIX}<semver>）`);
  }
  return parseMosVersion(tag.trim());
}

const CLI_FIELDS = ["version", "tag", "channel"];

/**
 * CLI：`node scripts/release/mos-version.mjs --assert mos-v3.0.0-rc.1 [--field version|tag|channel]`
 * 校验失败退出码 1；--field 只输出单个字段，方便 shell 内联取值。
 */
function main(argv = process.argv.slice(2)) {
  let assertInput = null;
  let field = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--assert") {
      assertInput = argv[++i];
    } else if (arg === "--field") {
      field = argv[++i];
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "用法：mos-version.mjs --assert <version|mos-v标签> [--field version|tag|channel]\n" +
          "校验 MOS 版本/标签并输出 JSON（或 --field 指定的单个字段）。上游 v<semver> 形态直接失败。",
      );
      return 0;
    } else {
      console.error(`未知参数：${arg}`);
      return 1;
    }
  }
  if (!assertInput) {
    console.error("缺少 --assert <version|mos-v标签>");
    return 1;
  }
  let parsed;
  try {
    parsed = parseMosVersion(assertInput);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const result = { ...parsed, channel: releaseChannelForVersion(parsed.version) };
  if (field) {
    if (!CLI_FIELDS.includes(field)) {
      console.error(`未知 --field：${field}（可选 ${CLI_FIELDS.join("|")}）`);
      return 1;
    }
    console.log(result[field]);
  } else {
    console.log(JSON.stringify(result));
  }
  return 0;
}

const entryHref = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryHref === import.meta.url) process.exitCode = main();
