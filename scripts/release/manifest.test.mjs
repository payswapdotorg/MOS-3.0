import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildReleaseManifest, validateReleaseManifest } from "./manifest.mjs";
import { parseMosVersion } from "./mos-version.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function context(overrides = {}) {
  return {
    version: "3.0.0-rc.1",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    zcodeBaseline: "3.18.0",
    buildRunId: "1234567890",
    buildRunUrl: "https://github.com/payswapdotorg/MOS-3.0/actions/runs/1234567890",
    builtAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fullMatrixArtifacts(version = "3.0.0-rc.1") {
  const files = [
    ["linux-x64", "AppImage", `MOS-${version}-linux-x64.AppImage`],
    ["linux-x64", "deb", `MOS-${version}-linux-x64.deb`],
    ["mac-arm64", "dmg", `MOS-${version}-mac-arm64.dmg`],
    ["mac-arm64", "zip", `MOS-${version}-mac-arm64.zip`],
    ["mac-x64", "dmg", `MOS-${version}-mac-x64.dmg`],
    ["mac-x64", "zip", `MOS-${version}-mac-x64.zip`],
    ["win-x64", "exe", `MOS-${version}-win-x64.exe`],
  ];
  return files.map(([platform, format, filename]) => ({
    platform,
    format,
    filename,
    sizeBytes: 1024 * 1024 * 500,
    sha256: sha256(filename),
  }));
}

test("buildReleaseManifest 生成 rc 通道的完整矩阵 manifest", () => {
  const manifest = buildReleaseManifest(context(), fullMatrixArtifacts());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "MOS");
  assert.equal(manifest.version, "3.0.0-rc.1");
  assert.equal(manifest.tag, "mos-v3.0.0-rc.1");
  assert.equal(manifest.channel, "rc");
  assert.equal(manifest.signature.status, "unsigned");
  assert.equal(manifest.signature.reason, "no signing credentials configured for this RC");
  assert.equal(manifest.signature.attestationStatus, "skipped");
  assert.deepEqual(manifest.omittedTargets, [
    { target: "win-arm64", reason: "pending native/runtime smoke verification" },
    { target: "linux-arm64", reason: "pending native/runtime smoke verification" },
  ]);
  const appImage = manifest.targets.find((target) => target.filename.endsWith(".AppImage"));
  assert.equal(appImage.required, true);
  assert.equal(appImage.os, "linux");
  assert.equal(appImage.arch, "x64");
  assert.equal(appImage.minOs, "glibc >= 2.28 (RHEL 8 baseline)");
  const dmg = manifest.targets.find(
    (target) => target.platform === "mac-arm64" && target.format === "dmg",
  );
  assert.equal(dmg.minOs, "13.0.0");
  // 全矩阵 + required 标记符合 backlog §3（AppImage+deb / dmg+zip / exe 必选）。
  assert.deepEqual(
    validateReleaseManifest(manifest, {
      expectedPlatforms: ["linux-x64", "mac-arm64", "mac-x64", "win-x64"],
    }),
    [],
  );
});

test("channel 随版本语义变化；tag 可显式传入但必须与版本一致", () => {
  const stable = buildReleaseManifest(context({ version: "3.0.0" }), fullMatrixArtifacts("3.0.0"));
  assert.equal(stable.channel, "stable");
  assert.equal(stable.tag, "mos-v3.0.0");
  const explicit = buildReleaseManifest(context(), fullMatrixArtifacts());
  assert.equal(explicit.tag, parseMosVersion("3.0.0-rc.1").tag);
});

test("best-effort 产物标记 required=false；缺失的 optional 格式进入 limitations", () => {
  const artifacts = fullMatrixArtifacts();
  artifacts.push({
    platform: "linux-x64",
    format: "rpm",
    filename: "MOS-3.0.0-rc.1-linux-x64.rpm",
    sizeBytes: 1024,
    sha256: sha256("rpm"),
  });
  const manifest = buildReleaseManifest(context(), artifacts);
  const rpm = manifest.targets.find((target) => target.format === "rpm");
  assert.equal(rpm.required, false);
  // rpm 已产出但 pkg.tar.zst 缺失：限制必须显式可见。
  assert.ok(
    manifest.limitations.some((limitation) => limitation.includes("linux-x64 pkg.tar.zst omitted")),
  );
  assert.ok(!manifest.limitations.some((limitation) => limitation.includes("rpm omitted")));
});

test("产物缺 sizeBytes / sha256 时构建直接失败", () => {
  const artifacts = fullMatrixArtifacts();
  delete artifacts[0].sizeBytes;
  assert.throws(() => buildReleaseManifest(context(), artifacts), /sizeBytes/u);
  const badHash = fullMatrixArtifacts();
  badHash[0].sha256 = "not-a-hash";
  assert.throws(() => buildReleaseManifest(context(), badHash), /sha256/u);
  const unknownPlatform = fullMatrixArtifacts();
  unknownPlatform[0].platform = "plan-9";
  assert.throws(() => buildReleaseManifest(context(), unknownPlatform), /未知发布平台/u);
  assert.throws(() => buildReleaseManifest(context(), []), /至少一个发布产物/u);
});

test("validateReleaseManifest 抓出篡改与缺失（tag/哈希/通道/必选格式/平台齐全性）", () => {
  const base = buildReleaseManifest(context(), fullMatrixArtifacts());

  const wrongTag = structuredClone(base);
  wrongTag.tag = "v3.18.0";
  assert.ok(validateReleaseManifest(wrongTag).some((problem) => problem.includes("tag 必须为")));

  const wrongChannel = structuredClone(base);
  wrongChannel.channel = "stable";
  assert.ok(
    validateReleaseManifest(wrongChannel).some((problem) =>
      problem.includes("channel 必须为"),
    ),
  );

  const shortCommit = structuredClone(base);
  shortCommit.sourceCommit = "abc123";
  assert.ok(
    validateReleaseManifest(shortCommit).some((problem) =>
      problem.includes("完整 commit SHA"),
    ),
  );

  const badHash = structuredClone(base);
  badHash.targets[0].sha256 = "ABC";
  assert.ok(
    validateReleaseManifest(badHash).some((problem) =>
      problem.includes("sha256 必须为 64 位"),
    ),
  );

  const zeroSize = structuredClone(base);
  zeroSize.targets[0].sizeBytes = 0;
  assert.ok(validateReleaseManifest(zeroSize).some((problem) => problem.includes("sizeBytes")));

  const missingRequiredFormat = structuredClone(base);
  missingRequiredFormat.targets = missingRequiredFormat.targets.filter(
    (target) => !(target.platform === "mac-arm64" && target.format === "zip"),
  );
  assert.ok(
    validateReleaseManifest(missingRequiredFormat).some((problem) =>
      problem.includes("mac-arm64 缺少必选产物格式 zip"),
    ),
  );

  const missingPlatform = structuredClone(base);
  missingPlatform.targets = missingPlatform.targets.filter(
    (target) => target.platform !== "win-x64",
  );
  const problems = validateReleaseManifest(missingPlatform, {
    expectedPlatforms: ["linux-x64", "mac-arm64", "mac-x64", "win-x64"],
  });
  assert.ok(problems.some((problem) => problem.includes("发布矩阵缺少必选平台 win-x64")));

  const badAttestation = structuredClone(base);
  badAttestation.signature.attestationStatus = "verified";
  assert.ok(
    validateReleaseManifest(badAttestation).some((problem) =>
      problem.includes("signature.attestationStatus 非法"),
    ),
  );

  const signedClaim = structuredClone(base);
  signedClaim.signature.status = "signed";
  assert.ok(
    validateReleaseManifest(signedClaim).some((problem) =>
      problem.includes('只允许 signature.status = "unsigned"'),
    ),
  );
});
