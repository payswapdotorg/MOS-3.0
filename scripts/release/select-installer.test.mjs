import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildReleaseManifest } from "./manifest.mjs";
import { selectInstallerFromManifest } from "./select-installer.mjs";
import { detectHostOsArch } from "./artifacts.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function manifestFixture(version = "3.0.0-rc.1") {
  const files = [
    ["linux-x64", "AppImage", `MOS-${version}-linux-x64.AppImage`],
    ["linux-x64", "deb", `MOS-${version}-linux-x64.deb`],
    ["linux-x64", "rpm", `MOS-${version}-linux-x64.rpm`],
    ["mac-arm64", "dmg", `MOS-${version}-mac-arm64.dmg`],
    ["mac-arm64", "zip", `MOS-${version}-mac-arm64.zip`],
    ["mac-x64", "dmg", `MOS-${version}-mac-x64.dmg`],
    ["mac-x64", "zip", `MOS-${version}-mac-x64.zip`],
    ["win-x64", "exe", `MOS-${version}-win-x64.exe`],
  ];
  return buildReleaseManifest(
    {
      version,
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      zcodeBaseline: "3.18.0",
      buildRunId: "1",
      buildRunUrl: "https://example.invalid/runs/1",
    },
    files.map(([platform, format, filename]) => ({
      platform,
      format,
      filename,
      sizeBytes: 1024 * 1024,
      sha256: sha256(filename),
    })),
  );
}

const RELEASES_BASE = "https://github.com/payswapdotorg/MOS-3.0/releases/download";

test("select-installer 按 os/arch 唯一定位主安装包（dmg/exe/AppImage）", () => {
  const manifest = manifestFixture();
  // mac：dmg 与 zip 都必选，消费端默认选 dmg（OS 常规安装机制）。
  assert.deepEqual(selectInstallerFromManifest(manifest, { os: "mac", arch: "arm64" }), {
    filename: "MOS-3.0.0-rc.1-mac-arm64.dmg",
    sha256: sha256("MOS-3.0.0-rc.1-mac-arm64.dmg"),
    sizeBytes: 1024 * 1024,
    format: "dmg",
    downloadUrl: undefined,
  });
  assert.equal(
    selectInstallerFromManifest(manifest, { os: "mac", arch: "x64" }).filename,
    "MOS-3.0.0-rc.1-mac-x64.dmg",
  );
  // win：唯一必选 exe。
  assert.equal(
    selectInstallerFromManifest(manifest, { os: "win", arch: "x64" }).filename,
    "MOS-3.0.0-rc.1-win-x64.exe",
  );
  // linux：AppImage 优先于 deb；rpm 为 best-effort 不参与默认选择。
  assert.equal(
    selectInstallerFromManifest(manifest, { os: "linux", arch: "x64" }).filename,
    "MOS-3.0.0-rc.1-linux-x64.AppImage",
  );
});

test("select-installer 组装 downloadUrl = <releases-base>/<tag>/<filename>", () => {
  const manifest = manifestFixture();
  const selection = selectInstallerFromManifest(manifest, {
    os: "mac",
    arch: "arm64",
    releasesBase: RELEASES_BASE,
  });
  assert.equal(
    selection.downloadUrl,
    "https://github.com/payswapdotorg/MOS-3.0/releases/download/mos-v3.0.0-rc.1/MOS-3.0.0-rc.1-mac-arm64.dmg",
  );
});

test("select-installer 对未知矩阵/无匹配目标直接失败", () => {
  const manifest = manifestFixture();
  assert.throws(
    () => selectInstallerFromManifest(manifest, { os: "linux", arch: "arm64" }),
    /未登记/u,
  );
  const missing = manifestFixture();
  missing.targets = missing.targets.filter((target) => target.platform !== "win-x64");
  assert.throws(
    () => selectInstallerFromManifest(missing, { os: "win", arch: "x64" }),
    /没有 win-x64 的必选安装包/u,
  );
  // 篡改 manifest 后先在 manifest 校验层失败，而不是返回可疑选择。
  const tampered = manifestFixture();
  tampered.channel = "wrong";
  assert.throws(() => selectInstallerFromManifest(tampered, { os: "mac", arch: "arm64" }), /校验失败/u);
});

test("detectHostOsArch 覆盖 darwin/win32/linux 与 x64/arm64 映射", () => {
  assert.deepEqual(detectHostOsArch("darwin", "arm64"), { os: "mac", arch: "arm64" });
  assert.deepEqual(detectHostOsArch("darwin", "x64"), { os: "mac", arch: "x64" });
  assert.deepEqual(detectHostOsArch("win32", "x64"), { os: "win", arch: "x64" });
  assert.deepEqual(detectHostOsArch("linux", "x64"), { os: "linux", arch: "x64" });
  assert.throws(() => detectHostOsArch("plan9", "x64"), /不支持的宿主平台/u);
  assert.throws(() => detectHostOsArch("linux", "ia32"), /不支持的宿主架构/u);
});
