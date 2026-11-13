import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { MIN_INSTALLER_BYTES, collectArtifacts } from "./collect-artifacts.mjs";

const exec = promisify(execFile);

const installerBytes = MIN_INSTALLER_BYTES + 1;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mos-release-collect-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const distDir = join(directory, "dist");
  const outDir = join(directory, "release-out");
  await mkdir(distDir, { recursive: true });
  return { directory, distDir, outDir };
}

async function writeInstaller(distDir, filename, bytes = installerBytes) {
  const path = join(distDir, filename);
  await writeFile(path, Buffer.alloc(bytes, 0x6d));
  return path;
}

test("collect-artifacts 收集 linux-x64 必选（AppImage+deb）并如实报告 best-effort 缺失", async (t) => {
  const { distDir, outDir } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.deb");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-win-x64.exe");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-mac-arm64.dmg");
  await writeFile(join(distDir, "builder-debug.json"), "{}");
  const result = await collectArtifacts({ distDir, platform: "linux-x64", outDir });
  // 只收集目标平台 + 登记格式；win/mac 产物与无关文件都不得混入。
  assert.deepEqual(
    result.collected.map((entry) => entry.filename),
    ["MOS-3.0.0-rc.1-linux-x64.AppImage", "MOS-3.0.0-rc.1-linux-x64.deb"],
  );
  assert.deepEqual(result.missingOptional, ["rpm", "pkg.tar.zst"]);
  assert.deepEqual((await readdir(outDir)).sort(), [
    "MOS-3.0.0-rc.1-linux-x64.AppImage",
    "MOS-3.0.0-rc.1-linux-x64.deb",
  ]);
});

test("collect-artifacts 支持可选产物产出（rpm）与最新 mtime 去重", async (t) => {
  const { distDir, outDir } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.deb");
  const rpm = await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.rpm");
  // 同格式多份（历史残留）：必须取 mtime 最新的一份，与 bundle.mjs 产物选择同口径。
  const stale = await writeInstaller(distDir, "MOS-2.9.0-linux-x64.rpm");
  await utimes(rpm, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
  await utimes(stale, new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
  const result = await collectArtifacts({ distDir, platform: "linux-x64", outDir });
  assert.deepEqual(result.missingOptional, ["pkg.tar.zst"]);
  assert.deepEqual(
    result.collected.map((entry) => entry.filename),
    [
      "MOS-3.0.0-rc.1-linux-x64.AppImage",
      "MOS-3.0.0-rc.1-linux-x64.deb",
      "MOS-3.0.0-rc.1-linux-x64.rpm",
    ],
  );
  assert.equal(result.collected.find((entry) => entry.format === "rpm").required, false);
});

test("collect-artifacts：缺必选格式直接失败", async (t) => {
  const { distDir, outDir } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  await assert.rejects(
    collectArtifacts({ distDir, platform: "linux-x64", outDir }),
    /缺少必选产物：deb/u,
  );
  await assert.rejects(
    collectArtifacts({ distDir: join(distDir, "missing"), platform: "linux-x64", outDir }),
    /无法读取产物目录/u,
  );
  await assert.rejects(
    collectArtifacts({ distDir, platform: "plan-9", outDir }),
    /未知发布平台/u,
  );
});

test("collect-artifacts：feed 元数据（latest*.yml）整体失败；blockmap 记录为惰性残留且不上传", async (t) => {
  const { distDir, outDir } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.deb");
  // blockmap：electron-builder 26 在 mac 目标上无条件生成（无配置开关），无 feed 元数据时
  // 属于惰性残留 —— 收集继续，不上传（Windows 由 nsis.differentialPackage=false 源头关闭）。
  await writeFile(join(distDir, "MOS-3.0.0-rc.1-mac-arm64.zip.blockmap"), "diff");
  const result = await collectArtifacts({ distDir, platform: "linux-x64", outDir });
  const uploaded = result.collected.map((entry) => entry.filename).join(",");
  assert.ok(!uploaded.includes("blockmap"), "blockmap 不得进入发布产物集");
  await rm(join(distDir, "MOS-3.0.0-rc.1-mac-arm64.zip.blockmap"));
  // latest*.yml：feed 元数据，供应链硬违规。
  await writeFile(join(distDir, "latest-linux.yml"), "version: 3.0.0-rc.1");
  await assert.rejects(
    collectArtifacts({ distDir, platform: "linux-x64", outDir }),
    (error) => /更新元数据/u.test(error.message) && /latest-linux\.yml/u.test(error.message),
  );
});

test("collect-artifacts：_TEST 后缀与体积异常的必选产物都拒绝", async (t) => {
  const { distDir, outDir } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  // 测试后缀位于扩展名之前（buildDesktopArtifactName：${arch}${suffix}.${ext}）。
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64_TEST.deb");
  await assert.rejects(
    collectArtifacts({ distDir, platform: "linux-x64", outDir }),
    /测试后缀或非 MOS 身份/u,
  );
  await rm(join(distDir, "MOS-3.0.0-rc.1-linux-x64_TEST.deb"));
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.deb", MIN_INSTALLER_BYTES);
  await assert.rejects(
    collectArtifacts({ distDir, platform: "linux-x64", outDir }),
    /不像真实安装包/u,
  );
});

test("collect-artifacts CLI：缺必选产物退出码非零（fail loudly）", async (t) => {
  const { distDir, outDir, directory } = await fixture(t);
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  const failure = await exec(
    process.execPath,
    [
      join(import.meta.dirname, "collect-artifacts.mjs"),
      "--dist-dir",
      distDir,
      "--platform",
      "linux-x64",
      "--out-dir",
      outDir,
    ],
    { cwd: directory },
  ).catch((error) => error);
  assert.notEqual(failure.code, 0);
  assert.match(failure.stderr, /缺少必选产物：deb/u);
  // 自定义 required 矩阵（mac 的 dmg+zip）也可以工作。
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-mac-arm64.dmg");
  await writeInstaller(distDir, "MOS-3.0.0-rc.1-mac-arm64.zip");
  const { stdout } = await exec(
    process.execPath,
    [
      join(import.meta.dirname, "collect-artifacts.mjs"),
      "--dist-dir",
      distDir,
      "--platform",
      "mac-arm64",
      "--out-dir",
      outDir,
    ],
    { cwd: directory },
  );
  const listed = JSON.parse(stdout);
  assert.equal(listed.length, 2);
  assert.ok(listed.some((entry) => entry.filename.endsWith(".zip")));
});
