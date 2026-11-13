/**
 * release-manifest.json 的构建与校验（schema v1）。
 *
 * 字段契约来自 spec/backlog/release-engineering.md §4：MOS 版本/标签、来源提交 SHA、
 * ZCode 上游基线、构建运行标识、构建时间、每个产物的 OS/架构/文件名/格式/字节大小/
 * SHA-256/最低系统要求/是否必选，以及签名状态、显式省略的目标与已知限制。
 * 校验失败必须可见：发布 job 在创建草稿 release 前对本 manifest 做机械终验。
 */

import {
  MIN_OS_BY_OS,
  MOS_PLATFORMS,
  OPTIONAL_FORMATS_BY_PLATFORM,
  REQUIRED_FORMATS_BY_PLATFORM,
  describeOmittedTargets,
  formatKey,
} from "./artifacts.mjs";
import { MOS_VERSION_PATTERN, parseMosVersion, releaseChannelForVersion } from "./mos-version.mjs";

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;

const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40,64}$/;
const ATTESTATION_STATUSES = ["generated", "failed", "skipped"];
const UNSIGNED_REASON = "no signing credentials configured for this RC";

/**
 * 构建 release manifest。context 必填：version、sourceCommit、zcodeBaseline、buildRunId、
 * buildRunUrl；可选：tag（缺省由 version 推导）、builtAt（缺省当前时间）、attestationStatus
 * （缺省 "skipped"，绝不虚报）、limitations（追加在默认限制之后）。
 * artifacts 每项必须带 platform、format、filename、sizeBytes、sha256（缺一即抛错）。
 */
export function buildReleaseManifest(context, artifacts) {
  if (!context || typeof context !== "object") throw new Error("manifest context 不能为空");
  const parsed = parseMosVersion(context.version);
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("manifest 必须包含至少一个发布产物");
  }

  const targets = artifacts.map((artifact) => {
    const platform = MOS_PLATFORMS[artifact.platform];
    if (!platform) throw new Error(`未知发布平台：${String(artifact.platform)}`);
    if (!Number.isFinite(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      throw new Error(`产物 ${artifact.filename} 缺少有效 sizeBytes`);
    }
    if (typeof artifact.sha256 !== "string" || !HEX64.test(artifact.sha256)) {
      throw new Error(`产物 ${artifact.filename} 缺少有效 sha256`);
    }
    return {
      platform: artifact.platform,
      os: platform.os,
      arch: platform.arch,
      format: artifact.format,
      filename: artifact.filename,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      required: isRequiredFormat(artifact.platform, artifact.format),
      minOs: artifact.minOs ?? MIN_OS_BY_OS[platform.os],
    };
  });

  const attestationStatus = context.attestationStatus ?? "skipped";
  if (!ATTESTATION_STATUSES.includes(attestationStatus)) {
    throw new Error(
      `非法 attestationStatus：${attestationStatus}（可选 ${ATTESTATION_STATUSES.join("|")}）`,
    );
  }

  const limitations = [
    `Unsigned build: ${UNSIGNED_REASON}. Expect OS security prompts on first launch ` +
      "(macOS Gatekeeper / Windows SmartScreen); see the release notes for guidance.",
    "Auto-update is intentionally disabled; install updates manually from the GitHub Releases page.",
    `Build provenance attestation status: ${attestationStatus}.`,
    ...missingOptionalFormatLimitations(targets),
    ...(context.limitations ?? []),
  ];

  return {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    product: "MOS",
    version: parsed.version,
    tag: context.tag ?? parsed.tag,
    sourceCommit: context.sourceCommit,
    zcodeBaseline: context.zcodeBaseline,
    buildRunId: context.buildRunId,
    buildRunUrl: context.buildRunUrl,
    builtAt: context.builtAt ?? new Date().toISOString(),
    channel: releaseChannelForVersion(parsed.version),
    signature: {
      status: "unsigned",
      reason: UNSIGNED_REASON,
      attestationStatus,
    },
    targets,
    omittedTargets: describeOmittedTargets(),
    limitations,
  };
}

function isRequiredFormat(platform, format) {
  const required = REQUIRED_FORMATS_BY_PLATFORM[platform] ?? [];
  return required.some((candidate) => formatKey(candidate) === formatKey(format));
}

function missingOptionalFormatLimitations(targets) {
  const notes = [];
  for (const [platform, formats] of Object.entries(OPTIONAL_FORMATS_BY_PLATFORM)) {
    if (!targets.some((target) => target.platform === platform)) continue;
    for (const format of formats) {
      const produced = targets.some(
        (target) =>
          target.platform === platform && formatKey(target.format) === formatKey(format),
      );
      if (!produced) {
        notes.push(
          `${platform} ${format} omitted: best-effort target not produced by the runner ` +
            "(fpm/packaging dependencies unavailable); see release notes.",
        );
      }
    }
  }
  return notes;
}

/**
 * 机械校验 manifest。返回问题列表（空数组 = 通过）；不抛错，方便 CLI 一次性列出全部问题。
 * expectedPlatforms 用来核对"必选目标齐全"（发布工作流矩阵的全平台校验）。
 */
export function validateReleaseManifest(manifest, { expectedPlatforms = [] } = {}) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (!manifest || typeof manifest !== "object") return ["manifest 不是 JSON 对象"];

  if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion 必须为 ${RELEASE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest.product !== "MOS") fail(`product 必须为 "MOS"，实际 ${JSON.stringify(manifest.product)}`);

  if (typeof manifest.version !== "string" || !MOS_VERSION_PATTERN.test(manifest.version)) {
    fail(`version 不是合法 MOS semver：${JSON.stringify(manifest.version)}`);
  } else {
    if (manifest.tag !== `mos-v${manifest.version}`) {
      fail(`tag 必须为 mos-v${manifest.version}，实际 ${JSON.stringify(manifest.tag)}`);
    }
    const expectedChannel = releaseChannelForVersion(manifest.version);
    if (manifest.channel !== expectedChannel) {
      fail(
        `channel 必须为 ${expectedChannel}（版本 ${manifest.version}），实际 ${JSON.stringify(manifest.channel)}`,
      );
    }
  }

  for (const field of ["sourceCommit", "zcodeBaseline", "buildRunId", "buildRunUrl", "builtAt"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
      fail(`缺少必填字段 ${field}`);
    }
  }
  if (typeof manifest.sourceCommit === "string" && !COMMIT_SHA.test(manifest.sourceCommit)) {
    fail(`sourceCommit 必须是完整 commit SHA：${manifest.sourceCommit}`);
  }
  if (typeof manifest.builtAt === "string" && Number.isNaN(Date.parse(manifest.builtAt))) {
    fail(`builtAt 不是合法 ISO 时间：${manifest.builtAt}`);
  }

  const signature = manifest.signature;
  if (!signature || typeof signature !== "object") {
    fail("缺少 signature 对象");
  } else {
    if (signature.status !== "unsigned") {
      fail(`本 RC 只允许 signature.status = "unsigned"，实际 ${JSON.stringify(signature.status)}`);
    }
    if (typeof signature.reason !== "string" || !signature.reason.trim()) {
      fail("signature.reason 不能为空（如实记录未签名原因）");
    }
    if (
      signature.attestationStatus !== undefined &&
      !ATTESTATION_STATUSES.includes(signature.attestationStatus)
    ) {
      fail(`signature.attestationStatus 非法：${JSON.stringify(signature.attestationStatus)}`);
    }
  }

  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    fail("targets 必须是非空数组");
  } else {
    const seen = new Map();
    for (const target of manifest.targets) {
      const label = target?.filename ?? "(无文件名)";
      const platform = target?.platform;
      const expected = MOS_PLATFORMS[platform];
      if (!expected) {
        fail(`未知 target platform：${JSON.stringify(platform)}`);
        continue;
      }
      if (target.os !== expected.os || target.arch !== expected.arch) {
        fail(`target ${label} 的 os/arch 与平台 ${platform} 不一致`);
      }
      if (typeof target.format !== "string" || !target.format.trim()) {
        fail(`target ${label} 缺少 format`);
      }
      if (typeof target.filename !== "string" || !target.filename.trim()) {
        fail(`target ${label} 缺少 filename`);
      }
      if (!Number.isFinite(target.sizeBytes) || target.sizeBytes <= 0) {
        fail(`target ${label} 的 sizeBytes 必须为正数`);
      }
      if (typeof target.sha256 !== "string" || !HEX64.test(target.sha256)) {
        fail(`target ${label} 的 sha256 必须为 64 位小写 hex`);
      }
      if (typeof target.required !== "boolean") fail(`target ${label} 缺少 required 布尔值`);
      if (typeof target.minOs !== "string" || !target.minOs.trim()) {
        fail(`target ${label} 缺少 minOs`);
      }
      if (typeof target.filename === "string") {
        if (seen.has(target.filename)) fail(`target 文件名重复：${target.filename}`);
        seen.set(target.filename, true);
      }
    }
    // 已出现的平台必须带齐必选格式（缺一个都是"可发布但残缺"的矩阵）。
    const platforms = new Set(manifest.targets.map((target) => target?.platform));
    for (const platform of platforms) {
      for (const format of REQUIRED_FORMATS_BY_PLATFORM[platform] ?? []) {
        const present = manifest.targets.some(
          (target) =>
            target?.platform === platform && formatKey(target?.format ?? "") === formatKey(format),
        );
        if (!present) fail(`平台 ${platform} 缺少必选产物格式 ${format}`);
      }
    }
    // 发布工作流矩阵的全平台在场校验（backlog §4 "Fail the release if a required target is missing"）。
    for (const platform of expectedPlatforms) {
      if (!platforms.has(platform)) fail(`发布矩阵缺少必选平台 ${platform}`);
    }
  }

  if (!Array.isArray(manifest.omittedTargets) || manifest.omittedTargets.length === 0) {
    fail("omittedTargets 必须是非空数组（显式省略的目标，见 backlog §3）");
  } else {
    for (const omitted of manifest.omittedTargets) {
      if (!omitted?.target || !omitted?.reason) fail("omittedTargets 条目缺少 target/reason");
    }
  }
  if (!Array.isArray(manifest.limitations) || manifest.limitations.length === 0) {
    fail("limitations 必须是非空数组");
  } else {
    for (const limitation of manifest.limitations) {
      if (typeof limitation !== "string" || !limitation.trim()) fail("limitations 条目必须是非空字符串");
    }
  }

  return problems;
}
