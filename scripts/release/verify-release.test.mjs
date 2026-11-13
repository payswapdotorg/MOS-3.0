import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { generateSha256sums } from "./checksums.mjs";
import { generateReleaseManifestFile } from "./generate-release-manifest.mjs";
import { verifyRelease } from "./verify-release.mjs";

const exec = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mos-release-verify-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const FILES = [
  ["MOS-3.0.0-rc.1-linux-x64.AppImage", 3_000_000],
  ["MOS-3.0.0-rc.1-linux-x64.deb", 2_000_000],
  ["MOS-3.0.0-rc.1-mac-arm64.dmg", 4_000_000],
  ["MOS-3.0.0-rc.1-mac-arm64.zip", 5_000_000],
  ["MOS-3.0.0-rc.1-mac-x64.dmg", 4_500_000],
  ["MOS-3.0.0-rc.1-mac-x64.zip", 5_500_000],
  ["MOS-3.0.0-rc.1-win-x64.exe", 3_500_000],
];

async function buildReleaseDirectory(t, { mutateBefore, mutateAfter } = {}) {
  const directory = await fixture(t);
  for (const [filename, size] of FILES) {
    const buffer = Buffer.alloc(size, 0x5a);
    await writeFile(join(directory, filename), buffer);
  }
  // 模拟“产物集层面就缺平台”：manifest 生成前拿走文件，manifest 里就不会登记该平台。
  await mutateBefore?.(directory);
  const manifestPath = join(directory, "release-manifest.json");
  await generateReleaseManifestFile({
    artifactsDir: directory,
    outPath: manifestPath,
    version: "3.0.0-rc.1",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    zcodeBaseline: "3.18.0",
    buildRunId: "42",
    buildRunUrl: "https://github.com/payswapdotorg/MOS-3.0/actions/runs/42",
  });
  // SHA256SUMS 只覆盖实际存在的产物（与真实流水线一致：先有产物再生成清单）。
  const present = FILES.filter(([filename]) => existsSync(join(directory, filename)));
  await writeFile(
    join(directory, "SHA256SUMS"),
    await generateSha256sums(
      present.map(([filename]) => ({ path: join(directory, filename), filename })),
    ),
    "utf8",
  );
  // 模拟“manifest 定稿后”的篡改/缺失：必须被终验检出。
  await mutateAfter?.(directory);
  return { directory, manifestPath };
}

test("verify-release 本地模式：哈希/大小/SHA256SUMS/平台齐全性全通过", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t);
  const { problems, manifest } = await verifyRelease({
    artifactsDir: directory,
    manifestPath,
  });
  assert.deepEqual(problems, []);
  assert.equal(manifest.version, "3.0.0-rc.1");
  assert.equal(manifest.targets.length, FILES.length);
});

test("verify-release：产物被篡改后必须检出哈希不一致", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t, {
    mutateAfter: async (dir) => {
      // manifest 定稿后写入等长但不同内容：重算哈希必然与 manifest 不一致。
      const target = join(dir, "MOS-3.0.0-rc.1-linux-x64.deb");
      const buffer = Buffer.alloc(2_000_000, 0x21);
      await writeFile(target, buffer);
    },
  });
  const { problems } = await verifyRelease({ artifactsDir: directory, manifestPath });
  assert.ok(problems.some((problem) => problem.includes("SHA-256 不一致")), JSON.stringify(problems));
});

test("verify-release：SHA256SUMS 与 manifest 不一致必须失败", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t);
  // 缺一行（去掉 exe）→ SHA256SUMS 缺文件；再追加一行未登记文件 → 多出条目。
  const sums = await readFile(join(directory, "SHA256SUMS"), "utf8");
  const withoutExe = sums
    .split("\n")
    .filter((line) => line && !line.endsWith("win-x64.exe"))
    .join("\n");
  await writeFile(join(directory, "SHA256SUMS"), `${withoutExe}\n${"a".repeat(64)}  rogue.bin\n`);
  const { problems } = await verifyRelease({ artifactsDir: directory, manifestPath });
  assert.ok(
    problems.some((problem) =>
      problem.includes("SHA256SUMS 缺少 MOS-3.0.0-rc.1-win-x64.exe"),
    ),
  );
  assert.ok(problems.some((problem) => problem.includes("manifest 未登记的文件：rogue.bin")));
});

test("verify-release：缺平台产物（无 exe）必须失败", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t, {
    mutateBefore: async (dir) => {
      await rm(join(dir, "MOS-3.0.0-rc.1-win-x64.exe"));
    },
  });
  const { problems } = await verifyRelease({ artifactsDir: directory, manifestPath });
  assert.ok(
    problems.some((problem) => problem.includes("发布矩阵缺少必选平台 win-x64")),
    JSON.stringify(problems),
  );
});

test("verify-release CLI：本地目录验失败退出码非零", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t, {
    mutateAfter: async (dir) => {
      await rm(join(dir, "MOS-3.0.0-rc.1-mac-arm64.zip"));
    },
  });
  const failure = await exec(
    process.execPath,
    [
      join(import.meta.dirname, "verify-release.mjs"),
      "--artifacts-dir",
      directory,
      "--manifest",
      manifestPath,
    ],
    { cwd: directory },
  ).catch((error) => error);
  assert.notEqual(failure.code, 0);
  assert.match(failure.stderr, /发布终验失败/u);
});

test("verify-release 下载模式拒绝非 HTTPS 地址（不触网即可验证）", async (t) => {
  const { directory, manifestPath } = await buildReleaseDirectory(t);
  const { problems } = await verifyRelease({
    artifactsDir: directory,
    manifestPath,
    // 非 HTTPS 的下载基址必须在发请求前被拒绝，而不是等 fetch 报错。
    downloadBaseUrl: "http://127.0.0.1:1/releases/download/mos-v3.0.0-rc.1",
  });
  assert.ok(
    problems.some((problem) => problem.includes("只接受 HTTPS 下载地址")),
    JSON.stringify(problems),
  );
});
