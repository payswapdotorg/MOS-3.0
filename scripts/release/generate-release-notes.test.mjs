import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateReleaseNotesFile } from "./generate-release-notes.mjs";
import { buildReleaseManifest } from "./manifest.mjs";
import { generateReleaseManifestFile } from "./generate-release-manifest.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mos-release-notes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("发布说明包含版本/未签名声明/安装指引/校验指引/省略目标/限制（含证据摘要）", async (t) => {
  const directory = await fixture(t);
  const evidenceDir = join(directory, "smoke-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, "smoke-evidence-mac-arm64.json"),
    JSON.stringify({
      platform: "mac-arm64",
      status: "passed",
      mosVersion: "3.0.0-rc.1",
      sha256: sha256("dmg"),
    }),
  );
  await writeFile(
    join(evidenceDir, "smoke-evidence-linux-x64.json"),
    JSON.stringify({ platform: "linux-x64", passed: true }),
  );
  await writeFile(join(evidenceDir, "not-json.json"), "{oops");

  const manifestPath = join(directory, "release-manifest.json");
  // 用真实 manifest 生成管线，保证说明与 manifest 字段同源。
  const manifest = buildReleaseManifest(
    {
      version: "3.0.0-rc.1",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      zcodeBaseline: "3.18.0",
      buildRunId: "7",
      buildRunUrl: "https://github.com/payswapdotorg/MOS-3.0/actions/runs/7",
      attestationStatus: "failed",
    },
    [
      ["linux-x64", "AppImage", "MOS-3.0.0-rc.1-linux-x64.AppImage"],
      ["linux-x64", "deb", "MOS-3.0.0-rc.1-linux-x64.deb"],
      ["mac-arm64", "dmg", "MOS-3.0.0-rc.1-mac-arm64.dmg"],
      ["mac-arm64", "zip", "MOS-3.0.0-rc.1-mac-arm64.zip"],
      ["win-x64", "exe", "MOS-3.0.0-rc.1-win-x64.exe"],
    ].map(([platform, format, filename]) => ({
      platform,
      format,
      filename,
      sizeBytes: 1024 * 1024 * 300,
      sha256: sha256(filename),
    })),
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const outPath = join(directory, "notes.md");
  await generateReleaseNotesFile({ manifestPath, outPath, evidenceDir });
  const notes = await readFile(outPath, "utf8");

  assert.match(notes, /# MOS 3\.0\.0-rc\.1 \(Release Candidate\)/u);
  assert.match(notes, /Source commit.*0123456789abcdef0123456789abcdef01234567/u);
  assert.match(notes, /ZCode upstream baseline.*3\.18\.0/u);
  // 未签名状态与 OS 安全指引必须如实出现；attestation 状态 failed 也必须如实出现。
  assert.match(notes, /UNSIGNED/u);
  assert.match(notes, /Gatekeeper/u);
  assert.match(notes, /SmartScreen/u);
  assert.match(notes, /attestation status: \*\*failed\*\*/u);
  assert.doesNotMatch(notes, /attestation verified|notarized/u);
  // 安装指引按平台出现；校验指引给出 sha256sum -c。
  assert.match(notes, /chmod \+x MOS-3\.0\.0-rc\.1-linux-x64\.AppImage/u);
  assert.match(notes, /sudo apt install \.\/MOS-3\.0\.0-rc\.1-linux-x64\.deb/u);
  assert.match(notes, /拖入 Applications/u);
  assert.match(notes, /sha256sum -c SHA256SUMS/u);
  // 显式省略目标与已知限制。
  assert.match(notes, /win-arm64.*pending native\/runtime smoke verification/u);
  assert.match(notes, /linux-arm64.*pending native\/runtime smoke verification/u);
  assert.match(notes, /pkg\.tar\.zst omitted/u);
  // 证据摘要：已知字段如实汇总；解析失败的非 JSON 证据不虚构结论。
  assert.match(notes, /smoke-evidence-mac-arm64\.json.*platform=mac-arm64, status=passed/u);
  assert.match(notes, /smoke-evidence-linux-x64\.json.*status=passed/u);
  assert.match(notes, /not-json\.json.*非 JSON 对象/u);
});

test("无 evidence-dir 时明确声明“无冒烟证据文件”，而不是留空段落", async (t) => {
  const directory = await fixture(t);
  const artifactsDir = join(directory, "release-out");
  await mkdir(artifactsDir, { recursive: true });
  for (const filename of [
    "MOS-3.1.0-linux-x64.AppImage",
    "MOS-3.1.0-linux-x64.deb",
    "MOS-3.1.0-mac-arm64.dmg",
    "MOS-3.1.0-mac-arm64.zip",
    "MOS-3.1.0-win-x64.exe",
  ]) {
    await writeFile(join(artifactsDir, filename), Buffer.alloc(1024, 1));
  }
  const manifestPath = join(artifactsDir, "release-manifest.json");
  await generateReleaseManifestFile({
    artifactsDir,
    outPath: manifestPath,
    version: "3.1.0",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    zcodeBaseline: "3.18.0",
    buildRunId: "8",
    buildRunUrl: "https://github.com/payswapdotorg/MOS-3.0/actions/runs/8",
  });
  const outPath = join(directory, "notes.md");
  await generateReleaseNotesFile({ manifestPath, outPath });
  const notes = await readFile(outPath, "utf8");
  assert.match(notes, /# MOS 3\.1\.0 \(Stable\)/u);
  assert.match(notes, /无冒烟证据文件/u);
});
