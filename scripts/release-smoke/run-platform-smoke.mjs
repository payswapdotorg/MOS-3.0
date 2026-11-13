#!/usr/bin/env node
/* eslint-disable max-lines -- 单文件即流水线：步骤间共享 ctx（安装句柄/隔离家目录/seed 路径），
   拆分会把验收顺序、失败粘滞与证据写出拆进多个文件，评审时无法线性读完一次安装验收。 */
// run-platform-smoke —— 目标 OS CI runner 上的干净机安装/启动验收（release 冒烟第二段）。
//
// 用法（由发布工作流调用；工作流归 Worker A，本脚本不写工作流）：
//   node scripts/release-smoke/run-platform-smoke.mjs --platform linux-x64 \
//     --artifact MOS-3.0.0-rc.1-linux-x64.deb [--artifact MOS-3.0.0-rc.1-linux-x64.AppImage] \
//     --mos-version 3.0.0-rc.1 --evidence-out evidence.json [--workdir <dir>] \
//     [--upgrade-artifact MOS-3.0.1-rc.1-linux-x64.deb]
//
// 单一有序流水线，逐步落证据：任何一步 failed → 结束时非零退出（证据照常写出）。
// runner 扮演“干净机器”：不 clone 源码、不装 pnpm、不动真实家目录（HOME 隔离 +
// 上游 ZCode decoy 对照）。安装/启动/hook 链路只允许使用平台安装机制与应用自带
// Electron Node runtime，绝不调用系统 Node/pnpm/构建脚本。
//
// 步骤（与 backlog §6 验收项的映射见 docs/release/ACCEPTANCE-RC.md）：
//   verify-artifact → isolate-home → install → identity → launch（含重启）→
//   plugin-seeded → plugin-alive → session-hook → data-persistence/upgrade →
//   upstream-decoys-untouched → 证据写出。
//
// --self-test（内部）：用桩步骤跑通整条流水线编排与证据写出（无安装/无 GUI），
// 只用于开发沙箱自检，不作为任何平台验收证据。
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { artifactFacts } from "./lib/artifact-facts.mjs";
import { createEvidenceRecorder } from "./lib/evidence.mjs";
import {
  directoryEntryNames,
  executableFile,
  fileCount,
  missingPaths,
  nonEmptyFile,
  pathExists,
  readJsonOrNull,
  readFileOrNull,
} from "./lib/fs-asserts.mjs";
import {
  buildHookInvocation,
  buildSessionStartHookPayload,
  HOOK_OUTCOMES,
  runSessionStartHookCommand,
} from "./lib/hook-contract.mjs";
import { runMcpHandshake } from "./lib/mcp-handshake.mjs";
import {
  buildIsolatedEnv,
  defaultWindowsInstallDir,
  electronAppDataDir,
  electronUserDataDir,
  expectedArtifactFileNames,
  getPlatformSpec,
  mosDataBaseDir,
  MOS_APP_ID,
  MOS_DATA_BASE_DIR_NAME,
  MOS_DEB_INSTALL_DIR,
  MOS_LINUX_EXECUTABLE_NAME,
  MOS_LINUX_PACKAGE_NAME,
  MOS_PLUGIN_ID,
  MOS_PLUGIN_NAME,
  MOS_STUDIO_PLUGIN_RESOURCE_PATH,
  MOS_USER_DATA_MARKER_FILE,
  nsisUninstallRegistryKey,
  parseArtifactFileName,
  requiredStudioPluginFiles,
  seededPluginRoot,
  upstreamZCodeAppDataDir,
  upstreamZCodeDataDir,
} from "./lib/platforms.mjs";
import { commandExists, runCapture } from "./lib/spawn.mjs";

const SCHEMA = "mos-release-smoke/run-platform-smoke@1";
const MIN_ARTIFACT_BYTES = 1024 * 1024;
const USER_DATA_TIMEOUT_MS = 90_000;
const USER_DATA_RELAUNCH_TIMEOUT_MS = 60_000;
const SEED_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;
const DECOY_MARKER_FILE = "marker-upstream-zcode";

const USAGE = `用法：node scripts/release-smoke/run-platform-smoke.mjs --platform <linux-x64|linux-arm64|mac-x64|mac-arm64|win-x64|win-arm64> --artifact <installer-path> [--artifact <second-installer>] --mos-version <semver> --evidence-out <path.json> [--workdir <dir>] [--upgrade-artifact <path>] [--self-test]

选项：
  --platform         平台目标键（必须与本 runner 平台一致）
  --artifact         安装包路径（linux 可重复传入 deb+AppImage，两个都测）
  --mos-version      MOS 发布版本
  --evidence-out     证据 JSON 输出路径（必填；步骤失败也会写出）
  --workdir          工作目录（默认 <cwd>/mos-release-smoke-work）
  --upgrade-artifact 升级安装包（传入时执行原地升级验收；缺省记 skipped (same-version RC)）
  --self-test        内部自检：桩步骤跑通流水线编排与证据写出（不安装/无 GUI，不作验收证据）
  --help             打印本说明`;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    platform: null,
    /** @type {string[]} */
    artifacts: [],
    mosVersion: null,
    evidenceOut: null,
    workdir: null,
    upgradeArtifact: null,
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--platform") parsed.platform = argv[++i];
    else if (arg === "--artifact") parsed.artifacts.push(argv[++i]);
    else if (arg === "--mos-version") parsed.mosVersion = argv[++i];
    else if (arg === "--evidence-out") parsed.evidenceOut = argv[++i];
    else if (arg === "--workdir") parsed.workdir = argv[++i];
    else if (arg === "--upgrade-artifact") parsed.upgradeArtifact = argv[++i];
    else if (arg === "--self-test") parsed.selfTest = true;
    else throw new Error(`未知参数：${arg}\n${USAGE}`);
  }
  if (parsed.help) return parsed;
  if (!parsed.platform) throw new Error(`缺少必填参数 --platform\n${USAGE}`);
  getPlatformSpec(parsed.platform);
  if (!parsed.mosVersion) throw new Error(`缺少必填参数 --mos-version\n${USAGE}`);
  if (!parsed.evidenceOut) throw new Error(`缺少必填参数 --evidence-out\n${USAGE}`);
  if (!parsed.selfTest && parsed.artifacts.length === 0) {
    throw new Error(`缺少必填参数 --artifact（自检模式除外）\n${USAGE}`);
  }
  return parsed;
}

/** 等待目录出现且内含至少一个文件（Electron userData 首启断言）。 */
async function waitForDirWithFile(dir, timeoutMs, note) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fileCount(dir)) > 0) return { ok: true, waitedMs: timeoutMs - (deadline - Date.now()) };
    await delay(POLL_INTERVAL_MS);
  }
  return { ok: false, waitedMs: timeoutMs, note };
}

/** 等待目录出现（存在即可，不看内容）。 */
async function waitForDir(dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(dir)) return { ok: true };
    await delay(POLL_INTERVAL_MS);
  }
  return { ok: false };
}

/**
 * 驱动安装包内 agent 走真实 bootstrap seed（`plugins list` 子命令 → resolveOfficialPluginRoots
 * → prepare → 落盘官方插件缓存；实测 seed 仅在插件发现时触发，裸 app-server 等协议请求不 seed）。
 *
 * 为什么需要它：桌面首启可能停在 onboarding（未登录不进入 host/agent 阶段）。本步骤用与桌面
 * buildHostProcessEnv 相同语义的环境直接运行安装包自带的 glm/zcode.cjs —— 同一份安装资产、
 * 同一套隔离家目录，不依赖登录；环境必须显式携带 MOS 的全套数据隔离变量，agent 才不会
 * 回落到 ~/.zcode（storage.dir/sessionDb/log 默认都从字面 homedir() 派生）。
 */
async function driveAgentSeed(ctx, { timeoutMs = 120_000 } = {}) {
  if (!ctx.agentRunner) {
    return { ok: false, reason: "install 步骤未记录 agentRunner（安装失败级联）" };
  }
  const zcodeCjs = join(ctx.agentRunner.resourcesDir, "glm", "zcode.cjs");
  if (!(await pathExists(zcodeCjs))) {
    return { ok: false, reason: `安装包缺少 agent bundle：${zcodeCjs}`, zcodeCjs };
  }
  const mosDataRoot = join(mosDataBaseDir(ctx.home), ".zcode");
  const env = {
    ...ctx.env,
    ELECTRON_RUN_AS_NODE: "1",
    ZCODE_DATA_BASE_DIR: mosDataBaseDir(ctx.home),
    ZCODE_STORAGE_DIR: mosDataRoot,
    ZCODE_SESSION_DB_PATH: join(mosDataRoot, "cli", "db", "db.sqlite"),
    ZCODE_LOG_DIR: join(mosDataRoot, "cli", "log"),
  };
  const child = spawn(ctx.agentRunner.binary, [zcodeCjs, "plugins", "list"], {
    cwd: ctx.workdir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    if (output.length < 100_000) output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    if (output.length < 100_000) output += String(chunk);
  });
  const seedWait = await waitForDir(ctx.seededRoot, timeoutMs);
  let terminate = "n/a";
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === "win32") {
        const kill = await runCapture("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeoutMs: 30_000 });
        terminate = kill.code === 0 ? "taskkill" : "taskkill-failed";
      } else {
        process.kill(-child.pid, "SIGTERM");
        terminate = "sigterm";
      }
    } catch {
      try {
        child.kill("SIGTERM");
        terminate = "child-sigterm";
      } catch {
        terminate = "already-exited";
      }
    }
  }
  return {
    ok: seedWait.ok,
    binary: ctx.agentRunner.binary,
    zcodeCjs,
    seededWithinAgentRun: seedWait.ok,
    terminate,
    outputTail: output.slice(-2000),
  };
}

/** decoy 准备：目录不存在则创建带 marker 的诱饵；已存在（真实上游数据）绝不写入，只做快照。 */
async function prepareDecoy(dir, note) {
  const markerPath = join(dir, DECOY_MARKER_FILE);
  const existing = await pathExists(dir);
  if (existing) {
    return {
      dir,
      mode: "observed-existing",
      note: `${note}：目录已存在（真实上游数据，绝不写入）；只做清单/内容快照，漂移仅记录不判失败`,
      markerPath: null,
      markerContent: null,
      baselineEntries: await directoryEntryNames(dir),
      baselineMarker: await readFileOrNull(markerPath),
    };
  }
  await mkdir(dir, { recursive: true });
  const markerContent = `upstream-zcode-decoy ${new Date().toISOString()}\n`;
  await writeFile(markerPath, markerContent, "utf8");
  return {
    dir,
    mode: "created-decoy",
    note,
    markerPath,
    markerContent,
    baselineEntries: await directoryEntryNames(dir),
    baselineMarker: markerContent,
  };
}

/** decoy 对照：自建诱饵必须原样；真实上游目录漂移只记录（避免外部活动误报）。 */
async function checkDecoyUntouched(decoy) {
  const currentEntries = await directoryEntryNames(decoy.dir);
  const changes = [];
  if (currentEntries === null) {
    changes.push("decoy 目录消失");
  } else {
    const baseline = decoy.baselineEntries ?? [];
    for (const entry of baseline) {
      if (!currentEntries.includes(entry)) changes.push(`条目消失：${entry}`);
    }
    for (const entry of currentEntries) {
      if (!baseline.includes(entry)) changes.push(`新增条目：${entry}`);
    }
  }
  if (decoy.mode === "created-decoy") {
    const currentMarker = await readFileOrNull(decoy.markerPath);
    if (currentMarker !== decoy.markerContent) changes.push("marker 内容被改写");
    return { untouched: changes.length === 0, changes };
  }
  return { untouched: changes.length === 0, changes, observed: true };
}

/** 启动 Electron 应用（linux 优先 xvfb-run -a；调用方已提供 DISPLAY 时直启；均不可用时降级直启并如实记录）。 */
async function launchElectronApp({ binary, args, env, cwd, platformKey, label }) {
  let command = binary;
  let finalArgs = [...args];
  let mode = "direct";
  if (platformKey.startsWith("linux")) {
    if (env.DISPLAY && env.DISPLAY.trim() !== "") {
      // 调用方已提供 X 显示（如预启 Xvfb -ac 的 CI 或本地复现环境）：直启，不再包一层 xvfb-run
      // （xvfb-run 依赖 xauth，部分最小环境缺失；预置 DISPLAY 是同等有效的验收形态）。
      mode = `direct (DISPLAY=${env.DISPLAY.trim()} 由调用方提供)`;
    } else if (await commandExists("xvfb-run")) {
      command = "xvfb-run";
      finalArgs = ["-a", binary, ...args];
      mode = "xvfb-run -a";
    } else {
      mode = "direct (xvfb-run 不可用；无显示服务器大概率启动失败，降级记录)";
    }
  }
  const child = spawn(command, finalArgs, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let output = "";
  const record = (chunk) => {
    if (output.length < 200_000) output += String(chunk);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  const exited = new Promise((resolveExit) => {
    child.once("close", (code) => resolveExit(code));
    child.once("error", () => resolveExit(null));
  });
  return { label, child, mode, exited, output: () => output };
}

/** 终止应用：进程组 SIGTERM → SIGKILL（unix）；taskkill 优雅 → /T /F（Windows）。 */
async function terminateElectronApp(launch, { platformKey }) {
  const child = launch.child;
  if (child.exitCode !== null || child.signalCode !== null) {
    return { terminated: true, mode: "already-exited" };
  }
  if (platformKey.startsWith("win")) {
    await runCapture("taskkill", ["/PID", String(child.pid)], { timeoutMs: 30_000 });
    for (let i = 0; i < 10; i += 1) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return { terminated: true, mode: "taskkill-graceful" };
      }
      await delay(1000);
    }
    const forced = await runCapture("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeoutMs: 30_000 });
    await Promise.race([
      launch.exited,
      delay(15_000).then(() => null),
    ]);
    return { terminated: forced.code === 0, mode: "taskkill-force", code: forced.code, stderr: forced.stderr?.slice(-2000) };
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // 已退出。
    }
  }
  const exited = await Promise.race([launch.exited, delay(15_000).then(() => null)]);
  if (exited !== null) return { terminated: true, mode: "sigterm" };
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // 已退出。
    }
  }
  await Promise.race([launch.exited, delay(10_000).then(() => null)]);
  return { terminated: true, mode: "sigterm-then-sigkill" };
}

/** 解析 hdiutil attach -plist 输出，取挂载点。 */
function parseHdiutilMountPoints(plistText) {
  const points = [];
  const systemEntities = /<key>system-entities<\/key>[\s\S]*?<\/array>/.exec(plistText);
  const block = systemEntities ? systemEntities[0] : plistText;
  const pattern = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g;
  let match = pattern.exec(block);
  while (match) {
    if (match[1].startsWith("/Volumes/")) points.push(match[1]);
    match = pattern.exec(block);
  }
  return points;
}

/** 解析 Info.plist（plutil -p 优先，退回 XML 正则）。 */
function parseInfoPlist(text, mode) {
  if (mode === "plutil") {
    const info = {};
    for (const line of String(text).split(/\r?\n/)) {
      const match = /^\s*"([^"]+)"\s*=>\s*(?:"([^"]*)"|(.+?))\s*$/.exec(line);
      if (match) info[match[1]] = match[2] ?? match[3].trim();
    }
    return info;
  }
  const info = {};
  const pattern = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g;
  let match = pattern.exec(String(text));
  while (match) {
    info[match[1]] = match[2];
    match = pattern.exec(String(text));
  }
  return info;
}

/**
 * 主流水线。步骤实现按 ctx.selfTest 分流（真实安装 vs 桩）。
 * 全部步骤共享 ctx（工作目录/隔离环境/产物路径/启动句柄），证据逐步落盘到 recorder。
 */
async function runPipeline(args) {
  const spec = getPlatformSpec(args.platform);
  const workdir = resolve(args.workdir ?? join(process.cwd(), "mos-release-smoke-work"));
  await mkdir(workdir, { recursive: true });

  const recorder = createEvidenceRecorder({
    schema: SCHEMA,
    meta: {
      platform: args.platform,
      mosVersion: args.mosVersion,
      workdir,
      selfTest: args.selfTest,
      node: process.version,
    },
  });

  /** @type {{ home: string, env: object, decoys: object[], realHome: string, artifacts: object[],
   *            installDir: string|null, binaries: object, launches: object[], seededRoot: string,
   *            markerPath: string, launchDegraded: boolean }} */
  const ctx = {
    spec,
    platformKey: args.platform,
    mosVersion: args.mosVersion,
    workdir,
    selfTest: args.selfTest,
    home: join(workdir, "home"),
    realHome: null,
    env: null,
    decoys: [],
    artifacts: [],
    installDir: null,
    binaries: {},
    launches: [],
    seededRoot: null,
    markerPath: null,
    launchDegraded: false,
  };

  // ── 1. verify-artifact：sha256 + 尺寸（干净机验收 §6.1 的本地部分）。 ──
  await recorder.step("verify-artifact", async (step) => {
    /** @type {object[]} */
    const facts = [];
    const artifactPaths = args.selfTest && args.artifacts.length === 0
      ? [join(workdir, "self-test-artifact.bin")]
      : args.artifacts.map((path) => resolve(path));
    if (args.selfTest && args.artifacts.length === 0) {
      await writeFile(artifactPaths[0], Buffer.alloc(MIN_ARTIFACT_BYTES + 4096, 7));
    }
    for (const artifactPath of artifactPaths) {
      const file = basename(artifactPath);
      const parsed = parseArtifactFileName(file);
      if (!parsed || !parsed.version) {
        step.failed({ message: `产物名不符合 MOS-<version>-<platform>-<arch>.<ext> 契约：${file}` });
        continue;
      }
      if (parsed.version !== args.mosVersion) {
        step.failed({
          message: `产物版本与 --mos-version 不一致：${file} 声明 ${parsed.version}`,
        });
      }
      if (!(await pathExists(artifactPath))) {
        step.failed({ message: `产物不存在：${artifactPath}` });
        continue;
      }
      const fact = await artifactFacts(artifactPath);
      fact.parsed = parsed;
      if (fact.sizeBytes <= MIN_ARTIFACT_BYTES) {
        step.failed({ message: `产物体积异常（≤${MIN_ARTIFACT_BYTES} 字节）：${file}`, sizeBytes: fact.sizeBytes });
      }
      facts.push(fact);
    }
    ctx.artifacts = facts;
    if (recorder.failures.every((failure) => failure.step !== "verify-artifact")) {
      step.passed({
        message: "sha256/size 已记录",
        artifacts: facts.map((fact) => ({ file: fact.file, sizeBytes: fact.sizeBytes, sha256: fact.sha256 })),
      });
    }
  });

  // ── 2. isolate-home：隔离家目录 + 上游 ZCode decoy。 ──
  await recorder.step("isolate-home", async (step) => {
    await mkdir(ctx.home, { recursive: true });
    // Windows 隔离环境需要的 AppData 目录预建（NSIS/Electron 首启前就存在）。
    if (ctx.platformKey.startsWith("win")) {
      await mkdir(join(ctx.home, "AppData", "Roaming"), { recursive: true });
      await mkdir(join(ctx.home, "AppData", "Local"), { recursive: true });
    }
    ctx.env = buildIsolatedEnv(ctx.platformKey, ctx.home);
    // 自检模式不触碰真实家目录：真实家目录用工作目录内的替身模拟。
    ctx.realHome = ctx.selfTest
      ? join(workdir, "real-home-fixture")
      : (process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir());
    if (ctx.selfTest) {
      await mkdir(ctx.realHome, { recursive: true });
    }

    // decoy 1：隔离家目录内的 ~/.zcode（MOS 数据根必须是 ~/.mos/.zcode，绝不碰 ~/.zcode）。
    const upstreamDataDecoy = await prepareDecoy(
      upstreamZCodeDataDir(ctx.home),
      "上游 ZCode agent 数据目录（~/.zcode）诱饵：MOS 不得读写",
    );
    // decoy 2：真实家目录的 <appData>/ZCode（Electron userData 隔离对照；目录已存在时只观察）。
    const upstreamAppDataDecoy = await prepareDecoy(
      upstreamZCodeAppDataDir(ctx.platformKey, ctx.realHome),
      "上游 ZCode Electron userData（<appData>/ZCode）诱饵：MOS 不得读写",
    );
    ctx.decoys = [upstreamDataDecoy, upstreamAppDataDecoy];
    ctx.seededRoot = seededPluginRoot(ctx.home);
    ctx.markerPath = join(mosDataBaseDir(ctx.home), MOS_USER_DATA_MARKER_FILE);
    step.passed({
      message: "隔离家目录已建；HOME/USERPROFILE/APPDATA/XDG_* 已重定向；上游 decoy 已布防",
      home: ctx.home,
      realHome: ctx.realHome,
      userDataDir: electronUserDataDir(ctx.platformKey, ctx.home),
      expectedSeededPluginRoot: ctx.seededRoot,
      decoys: ctx.decoys.map((decoy) => ({ dir: decoy.dir, mode: decoy.mode, note: decoy.note })),
    });
  });

  // ── 3. install：平台安装机制（绝不使用 Node/pnpm/构建脚本）。 ──
  await recorder.step("install", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：真实安装未执行（不作验收证据）" });
      return;
    }
    const detail = {};
    if (ctx.platformKey.startsWith("linux")) {
      detail.debs = [];
      detail.appimages = [];
      const debs = ctx.artifacts.filter((fact) => fact.parsed.extension.toLowerCase() === "deb");
      const appImages = ctx.artifacts.filter((fact) => fact.parsed.extension.toLowerCase() === "appimage");
      // 命名契约下 linux 必须两个产物都过一遍（backlog §3：AppImage 与 deb）。
      // 只传了一个时按同名规则在产物目录补找兄弟产物；找不到则记 degraded（单产物任务）。
      if (debs.length === 0 || appImages.length === 0) {
        for (const fact of ctx.artifacts) {
          for (const expected of expectedArtifactFileNames(ctx.platformKey, fact.parsed.version)) {
            const candidate = join(dirname(fact.path), expected);
            if (await pathExists(candidate)) {
              if (expected.endsWith(".deb") && debs.length === 0) {
                const sibling = await artifactFacts(candidate);
                sibling.parsed = parseArtifactFileName(expected);
                debs.push(sibling);
              }
              if (expected.endsWith(".AppImage") && appImages.length === 0) {
                const sibling = await artifactFacts(candidate);
                sibling.parsed = parseArtifactFileName(expected);
                appImages.push(sibling);
              }
            }
          }
        }
      }
      if (debs.length === 0) {
        step.failed({ message: "linux 验收需要 deb 产物（--artifact 或同目录兄弟产物）" });
      }
      // 3a) deb：dpkg -i（root 直接跑，否则 sudo -n）。
      for (const deb of debs) {
        const isRoot = process.getuid?.() === 0;
        const command = isRoot ? "dpkg" : "sudo";
        const dpkgArgs = isRoot ? ["-i", deb.path] : ["-n", "dpkg", "-i", deb.path];
        const install = await runCapture(command, dpkgArgs, { timeoutMs: 600_000 });
        const verify = await runCapture("dpkg", ["-s", MOS_LINUX_PACKAGE_NAME], { timeoutMs: 30_000 });
        const verifyLines = {};
        for (const line of verify.stdout.split(/\r?\n/)) {
          const match = /^([A-Za-z-]+): ?(.*)$/.exec(line);
          if (match && verifyLines[match[1]] === undefined) verifyLines[match[1]] = match[2].trim();
        }
        detail.debs.push({
          file: deb.file,
          installCode: install.code,
          installError: install.error,
          packageName: verifyLines.Package ?? null,
          installedVersion: verifyLines.Version ?? null,
          status: verifyLines.Status ?? null,
          stderr: install.stderr?.slice(-2000),
        });
        if (install.code !== 0) {
          step.failed({ message: `dpkg -i 失败：${deb.file}`, detail: detail.debs.at(-1) });
        } else if (verifyLines.Package !== MOS_LINUX_PACKAGE_NAME || verifyLines.Status?.includes("installed") !== true) {
          step.failed({ message: `dpkg -s ${MOS_LINUX_PACKAGE_NAME} 未确认安装`, detail: detail.debs.at(-1) });
        }
      }
      const debBinary = join(MOS_DEB_INSTALL_DIR, MOS_LINUX_EXECUTABLE_NAME);
      if (debs.length > 0 && (await pathExists(debBinary))) {
        ctx.installDir = MOS_DEB_INSTALL_DIR;
        ctx.binaries.deb = debBinary;
        ctx.agentRunner = {
          binary: debBinary,
          resourcesDir: join(MOS_DEB_INSTALL_DIR, "resources"),
        };
      } else if (debs.length > 0) {
        step.failed({ message: `deb 安装后缺少 ${debBinary}` });
      }
      // 3b) AppImage：授权可执行；无 FUSE 的容器先解包（squashfs-root 直接可执行）。
      for (const appImage of appImages) {
        const workCopy = join(workdir, appImage.file);
        await rm(workCopy, { force: true });
        const { copyFile } = await import("node:fs/promises");
        await copyFile(appImage.path, workCopy);
        await chmod(workCopy, 0o755);
        let binary = workCopy;
        let mode = "in-place";
        const fuseAvailable = await pathExists("/dev/fuse");
        if (!fuseAvailable) {
          const extract = await runCapture(workCopy, ["--appimage-extract"], { cwd: workdir, timeoutMs: 300_000 });
          binary = join(workdir, "squashfs-root", MOS_LINUX_EXECUTABLE_NAME);
          mode = extract.code === 0 && (await pathExists(binary)) ? "extracted (无 /dev/fuse)" : "extract-failed";
          if (mode === "extract-failed") {
            step.failed({ message: "AppImage --appimage-extract 失败", stderr: extract.stderr?.slice(-2000) });
            continue;
          }
        }
        detail.appimages.push({ file: appImage.file, binary, mode, fuseAvailable });
        ctx.binaries.appimage = binary;
        if (!ctx.agentRunner) {
          const resourcesDir = binary.startsWith(join(workdir, "squashfs-root"))
            ? join(workdir, "squashfs-root", "resources")
            : null;
          if (resourcesDir && (await pathExists(resourcesDir))) {
            ctx.agentRunner = { binary, resourcesDir };
          }
        }
      }
      if (appImages.length === 0) {
        step.degraded({ message: "本任务未提供 AppImage 产物（linux 命名契约要求 AppImage+deb 双产物；发布矩阵需在另一个 job 补测）" });
      }
    } else if (ctx.platformKey.startsWith("mac")) {
      // dmg：hdiutil attach → ditto/cp -R 到 ~/Applications（每用户，无需 sudo）→ detach。
      const dmg = ctx.artifacts.find((fact) => fact.parsed.extension.toLowerCase() === "dmg") ?? ctx.artifacts[0];
      const installRoot = join(ctx.home, "Applications");
      await mkdir(installRoot, { recursive: true });
      const attach = await runCapture(
        "hdiutil",
        ["attach", "-plist", "-nobrowse", "-readonly", dmg.path],
        { timeoutMs: 300_000 },
      );
      if (attach.code !== 0) {
        step.failed({ message: "hdiutil attach 失败", stderr: attach.stderr?.slice(-2000) });
        return;
      }
      const mountPoints = parseHdiutilMountPoints(attach.stdout);
      const volume = mountPoints.find((point) => point) ?? null;
      if (!volume) {
        step.failed({ message: "hdiutil attach 未返回 /Volumes 挂载点", stdout: attach.stdout.slice(-2000) });
        return;
      }
      const appOnVolume = join(volume, "MOS.app");
      if (!(await pathExists(appOnVolume))) {
        step.failed({ message: `挂载卷缺少 MOS.app：${appOnVolume}` });
        await runCapture("hdiutil", ["detach", volume], { timeoutMs: 60_000 });
        return;
      }
      const copy = await runCapture("ditto", [appOnVolume, join(installRoot, "MOS.app")], { timeoutMs: 600_000 });
      const detach = await runCapture("hdiutil", ["detach", volume], { timeoutMs: 60_000 });
      // 未签名构建的隔离属性清理：模拟用户右键打开的放行（只对隔离副本，不改原始下载件）。
      const quarantine = await runCapture("xattr", ["-dr", "com.apple.quarantine", join(installRoot, "MOS.app")], {
        timeoutMs: 60_000,
      });
      detail.dmg = {
        volume,
        copyCode: copy.code,
        detachCode: detach.code,
        quarantineClearCode: quarantine.code,
        quarantineClearNote:
          "未签名构建的记录在案放行：下载件带 com.apple.quarantine，直启二进制前对隔离副本执行 xattr -dr（等价用户右键打开授权）；签名构建上该命令为无操作",
      };
      ctx.installDir = join(installRoot, "MOS.app");
      ctx.binaries.app = join(ctx.installDir, "Contents", "MacOS", "MOS");
      ctx.agentRunner = {
        binary: ctx.binaries.app,
        resourcesDir: join(ctx.installDir, "Contents", "Resources"),
      };
      if (copy.code !== 0 || !(await pathExists(ctx.binaries.app))) {
        step.failed({ message: "MOS.app 复制到 ~/Applications 失败", detail: detail.dmg, stderr: copy.stderr?.slice(-2000) });
        return;
      }
    } else {
      // win：NSIS 静默安装（/S）→ 等卸载注册表键 + MOS.exe → 解析安装目录。
      const exe = ctx.artifacts.find((fact) => fact.parsed.extension.toLowerCase() === "exe") ?? ctx.artifacts[0];
      const installRun = await runCapture(exe.path, ["/S"], {
        cwd: dirname(exe.path),
        env: ctx.env,
        timeoutMs: 900_000,
      });
      detail.nsis = { file: exe.file, installCode: installRun.code, stderr: installRun.stderr?.slice(-2000) };
      const registryKey = nsisUninstallRegistryKey(MOS_APP_ID);
      const expectedInstallDir = defaultWindowsInstallDir(join(ctx.home, "AppData", "Local"));
      let installDir = expectedInstallDir;
      let installLocation = null;
      const deadline = Date.now() + 180_000;
      let registryFound = false;
      while (Date.now() < deadline) {
        const query = await runCapture(
          "reg",
          ["query", `HKCU\\${registryKey}`, "/v", "InstallLocation"],
          { timeoutMs: 30_000 },
        );
        if (query.code === 0) {
          registryFound = true;
          const match = /InstallLocation\s+REG_SZ\s+(\S.*)$/m.exec(query.stdout);
          if (match) {
            installLocation = match[1].trim();
            installDir = installLocation;
          }
          break;
        }
        if (await pathExists(join(expectedInstallDir, "MOS.exe"))) break;
        await delay(POLL_INTERVAL_MS * 3);
      }
      detail.nsis.registryKey = `HKCU\\${registryKey}`;
      detail.nsis.registryFound = registryFound;
      detail.nsis.installLocation = installLocation;
      detail.nsis.defaultInstallDir = expectedInstallDir;
      ctx.installDir = installDir;
      ctx.binaries.exe = join(installDir, "MOS.exe");
      ctx.agentRunner = {
        binary: ctx.binaries.exe,
        resourcesDir: join(installDir, "resources"),
      };
      if (!(await pathExists(ctx.binaries.exe))) {
        step.failed({ message: `安装目录缺少 MOS.exe：${ctx.binaries.exe}`, detail: detail.nsis });
        return;
      }
      if (installRun.code !== 0) {
        step.failed({ message: "NSIS /S 静默安装失败", detail: detail.nsis });
        return;
      }
    }
    if (recorder.failures.every((failure) => failure.step !== "install")) {
      step.passed({ message: "平台安装机制完成", installDir: ctx.installDir, ...detail });
    }
  });

  // ── 4. identity：OS/包元数据必须指向 MOS，绝不与上游 ZCode 撞名。 ──
  await recorder.step("identity", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：身份断言未执行（不作验收证据）" });
      return;
    }
    const detail = {};
    if (ctx.platformKey.startsWith("linux")) {
      const verify = await runCapture("dpkg", ["-s", MOS_LINUX_PACKAGE_NAME], { timeoutMs: 30_000 });
      const lines = {};
      for (const line of verify.stdout.split(/\r?\n/)) {
        const match = /^([A-Za-z-]+): ?(.*)$/.exec(line);
        if (match && lines[match[1]] === undefined) lines[match[1]] = match[2].trim();
      }
      detail.dpkg = {
        packageName: lines.Package ?? null,
        version: lines.Version ?? null,
        maintainer: lines.Maintainer ?? null,
        status: lines.Status ?? null,
      };
      if (detail.dpkg.packageName !== MOS_LINUX_PACKAGE_NAME) {
        step.failed({ message: `dpkg 包名必须为 ${MOS_LINUX_PACKAGE_NAME}，实际 ${detail.dpkg.packageName}` });
      }
      if (detail.dpkg.version !== ctx.mosVersion) {
        step.failed({ message: `dpkg 版本必须为 ${ctx.mosVersion}，实际 ${detail.dpkg.version}` });
      }
      if (ctx.binaries.deb) {
        detail.debExecutable = {
          path: ctx.binaries.deb,
          present: await pathExists(ctx.binaries.deb),
          executable: await executableFile(ctx.binaries.deb),
        };
        if (!detail.debExecutable.present) {
          step.failed({ message: `缺少 deb 可执行入口 ${ctx.binaries.deb}` });
        }
      }
      // deb 的 desktop entry（/usr/share/applications/mos.desktop）。
      const desktopFile = join("/", "usr", "share", "applications", `${MOS_LINUX_EXECUTABLE_NAME}.desktop`);
      detail.desktopEntry = { path: desktopFile, present: await pathExists(desktopFile) };
      if (!detail.desktopEntry.present && ctx.binaries.deb) {
        step.failed({ message: `deb 安装后缺少 desktop entry ${desktopFile}` });
      }
    } else if (ctx.platformKey.startsWith("mac")) {
      const plistPath = join(ctx.installDir, "Contents", "Info.plist");
      let plist = null;
      let parsedVia = "xml";
      if (await commandExists("plutil")) {
        const plutil = await runCapture("plutil", ["-p", plistPath], { timeoutMs: 30_000 });
        if (plutil.code === 0) {
          plist = parseInfoPlist(plutil.stdout, "plutil");
          parsedVia = "plutil";
        }
      }
      if (!plist) {
        plist = parseInfoPlist((await readFileOrNull(plistPath)) ?? "", "xml");
      }
      detail.infoPlist = {
        parsedVia,
        CFBundleIdentifier: plist.CFBundleIdentifier ?? null,
        CFBundleName: plist.CFBundleName ?? null,
        CFBundleExecutable: plist.CFBundleExecutable ?? null,
        CFBundleShortVersionString: plist.CFBundleShortVersionString ?? null,
      };
      if (detail.infoPlist.CFBundleIdentifier !== MOS_APP_ID) {
        step.failed({ message: `CFBundleIdentifier 必须为 ${MOS_APP_ID}，实际 ${detail.infoPlist.CFBundleIdentifier}` });
      }
      if (detail.infoPlist.CFBundleName !== "MOS") {
        step.failed({ message: `CFBundleName 必须为 MOS，实际 ${detail.infoPlist.CFBundleName}` });
      }
      if (detail.infoPlist.CFBundleExecutable !== "MOS") {
        step.failed({ message: `CFBundleExecutable 必须为 MOS，实际 ${detail.infoPlist.CFBundleExecutable}` });
      }
      if (detail.infoPlist.CFBundleShortVersionString !== ctx.mosVersion) {
        step.failed({
          message: `CFBundleShortVersionString 必须为 ${ctx.mosVersion}，实际 ${detail.infoPlist.CFBundleShortVersionString}`,
        });
      }
    } else {
      const installEntries = await readdir(ctx.installDir, { withFileTypes: true });
      const exeNames = installEntries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe")).map((entry) => entry.name);
      detail.exeNames = exeNames;
      if (!exeNames.includes("MOS.exe")) {
        step.failed({ message: `安装目录缺少 MOS.exe（实际：${exeNames.join(", ") || "空"}）` });
      }
      const startMenuDir = join(ctx.home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
      const shortcutNames = (await directoryEntryNames(startMenuDir)) ?? [];
      detail.startMenuShortcuts = shortcutNames;
      // 可执行/快捷方式命名绝不出现上游 zcode 字样。
      const zcodeNamed = [...exeNames, ...shortcutNames].filter((name) => name.toLowerCase().includes("zcode"));
      detail.upstreamNamedEntries = zcodeNamed;
      if (zcodeNamed.length > 0) {
        step.failed({ message: `发现上游 ZCode 命名残留（必须全部为 MOS）：${zcodeNamed.join(", ")}` });
      }
      const mosShortcuts = shortcutNames.filter((name) => name.includes("MOS"));
      if (shortcutNames.length > 0 && mosShortcuts.length === 0) {
        step.degraded({ message: "开始菜单存在快捷方式但没有 MOS 命名项（记录为观察项）" });
      }
    }
    if (recorder.failures.every((failure) => failure.step !== "identity")) {
      step.passed({ message: "OS/包元数据身份断言通过", installDir: ctx.installDir, ...detail });
    }
  });

  // ── 5. launch：首启 → 等待 MOS userData → 落数据基座 marker → 终止 → 重启 → 终止。 ──
  const launchOnce = async (step, { label, binary, timeoutMs }) => {
    const args = ["--disable-gpu"];
    if (ctx.platformKey.startsWith("linux")) {
      args.push("--no-sandbox");
    }
    const launch = await launchElectronApp({
      binary,
      args,
      env: ctx.env,
      cwd: workdir,
      platformKey: ctx.platformKey,
      label,
    });
    ctx.launches.push(launch);
    const userData = await waitForDirWithFile(
      electronUserDataDir(ctx.platformKey, ctx.home),
      timeoutMs,
      "Electron userData (<appData>/MOS) 未出现或为空",
    );
    return { launch, userData };
  };

  await recorder.step("launch", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：真实启动未执行（不作验收证据）" });
      return;
    }
    const primaryBinary =
      ctx.binaries.deb ?? ctx.binaries.appimage ?? ctx.binaries.app ?? ctx.binaries.exe ?? null;
    if (!primaryBinary) {
      step.failed({ message: "无可启动二进制（install 步骤未产出）" });
      return;
    }
    const detail = { primaryBinary };
    // 首启。
    const first = await launchOnce(step, { label: "first-launch", binary: primaryBinary, timeoutMs: USER_DATA_TIMEOUT_MS });
    detail.firstLaunch = { mode: first.launch.mode, userDataOk: first.userData.ok, note: first.userData.note ?? null };
    if (!first.userData.ok) {
      ctx.launchDegraded = first.launch.mode.includes("xvfb") === false;
      step.failed({
        message: `首启后 ${USER_DATA_TIMEOUT_MS}ms 内 MOS userData 未就绪（模式：${first.launch.mode}）`,
        outputTail: first.launch.output().slice(-4000),
      });
      await terminateElectronApp(first.launch, { platformKey: ctx.platformKey });
      return;
    }
    // 等 seed 出官方插件缓存（首启期间 agent bootstrap 落盘；不等完就杀会误报 plugin-seeded）。
    const seedWait = await waitForDir(ctx.seededRoot, SEED_TIMEOUT_MS);
    detail.firstLaunch.seededWithinFirstLaunch = seedWait.ok;
    // 数据基座 marker（upgrade 步骤回查）。
    await mkdir(mosDataBaseDir(ctx.home), { recursive: true });
    await writeFile(
      ctx.markerPath,
      `${JSON.stringify({ marker: MOS_USER_DATA_MARKER_FILE, writtenAt: new Date().toISOString(), mosVersion: ctx.mosVersion }, null, 2)}\n`,
      "utf8",
    );
    const firstTerminate = await terminateElectronApp(first.launch, { platformKey: ctx.platformKey });
    detail.firstLaunch.terminate = firstTerminate;

    // 重启验收（backlog §6.4 的应用内重启部分；整机重启属手工项）。
    const relaunch = await launchOnce(step, { label: "relaunch", binary: primaryBinary, timeoutMs: USER_DATA_RELAUNCH_TIMEOUT_MS });
    detail.relaunch = { mode: relaunch.launch.mode, userDataOk: relaunch.userData.ok };
    const relaunchTerminate = await terminateElectronApp(relaunch.launch, { platformKey: ctx.platformKey });
    detail.relaunch.terminate = relaunchTerminate;
    if (!relaunch.userData.ok) {
      step.failed({
        message: `重启后 ${USER_DATA_RELAUNCH_TIMEOUT_MS}ms 内 MOS userData 未就绪`,
        outputTail: relaunch.launch.output().slice(-4000),
      });
      return;
    }
    // linux 双产物时补一次 AppImage 直启（同一隔离家目录，验证第二个产物同样可启动）。
    if (ctx.binaries.appimage && ctx.binaries.deb && ctx.binaries.appimage !== primaryBinary) {
      const appImageLaunch = await launchOnce(step, {
        label: "appimage-launch",
        binary: ctx.binaries.appimage,
        timeoutMs: USER_DATA_TIMEOUT_MS,
      });
      detail.appImageLaunch = { mode: appImageLaunch.launch.mode, userDataOk: appImageLaunch.userData.ok };
      await terminateElectronApp(appImageLaunch.launch, { platformKey: ctx.platformKey });
      if (!appImageLaunch.userData.ok) {
        step.failed({ message: "AppImage 直启后 userData 未就绪", outputTail: appImageLaunch.launch.output().slice(-4000) });
      }
    }
    if (recorder.failures.every((failure) => failure.step !== "launch")) {
      step.passed({ message: "首启 + 重启 + userData 隔离断言通过", ...detail });
    } else {
      step.note(detail);
    }
  });

  // ── 6. plugin-seeded：官方插件缓存断言 + 改写形态断言。 ──
  // App 首启（onboarding 未登录）可能不进入 host/agent 阶段；seed 断言在应用级等待未果时，
  // 用安装包内 agent 直接驱动 bootstrap seed（同一份安装资产；不依赖登录、不触碰 ~/.zcode）。
  await recorder.step("plugin-seeded", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：seed 断言未执行（不作验收证据）" });
      return;
    }
    const detail = { seededRoot: ctx.seededRoot };
    if (!(await pathExists(ctx.seededRoot))) {
      const agentSeed = await driveAgentSeed(ctx);
      detail.agentDrivenSeed = agentSeed;
      if (!agentSeed.ok) {
        step.failed({
          message: `官方插件缓存未 seed：${ctx.seededRoot}（app 首启与安装包内 agent 驱动均未产出；安装包可能未携带内置插件或 bootstrap 失败）`,
          agentDrivenSeed: agentSeed,
        });
        return;
      }
      detail.via = "agent-driven (app-server --stdio)";
    }
    const missing = await missingPaths(ctx.seededRoot, requiredStudioPluginFiles(ctx.platformKey));
    detail.missing = missing;
    if (missing.length > 0) {
      step.failed({ message: "seed 出的插件闭包缺文件", missing });
    }
    const koffiNative = await nonEmptyFile(
      join(ctx.seededRoot, "node_modules", "koffi", "build", "koffi", ctx.spec.koffiPlatformKey, "koffi.node"),
    );
    detail.koffiNative = koffiNative;
    if (!koffiNative.exists || koffiNative.size === 0) {
      step.failed({ message: `seed 闭包缺少目标平台 koffi 原生模块（${ctx.spec.koffiPlatformKey}）`, koffiNative });
    }

    // plugin.json 必须已改写：mcpServers.studio.command = 应用自带 Electron（非裸 node）。
    const manifest = await readJsonOrNull(join(ctx.seededRoot, ".zcode-plugin", "plugin.json"));
    const server = manifest?.mcpServers?.studio;
    const appBinary = ctx.binaries.deb ?? ctx.binaries.appimage ?? ctx.binaries.app ?? ctx.binaries.exe ?? "";
    const command = typeof server?.command === "string" ? server.command : null;
    const args = Array.isArray(server?.args) ? server.args : [];
    detail.rewrittenManifest = {
      command,
      args,
      env: server?.env ?? null,
      commandIsAppBinary: typeof command === "string" && command.length > 0 && command !== "node",
      commandReferencesInstalledBinary:
        typeof command === "string" &&
        (command.includes(appBinary) || appBinary.includes(basename(command ?? ""))),
      pluginRootExpanded: args.some((arg) => typeof arg === "string" && arg.includes("dist/server.mjs") && !arg.includes("${ZCODE_PLUGIN_ROOT}")),
      electronRunAsNode: server?.env?.ELECTRON_RUN_AS_NODE === "1",
    };
    if (!detail.rewrittenManifest.commandIsAppBinary) {
      step.failed({ message: "seed 后 plugin.json 的 mcpServers.studio.command 必须是应用自带二进制而非裸 node", detail: detail.rewrittenManifest });
    }
    if (!detail.rewrittenManifest.pluginRootExpanded) {
      step.failed({ message: "seed 后 plugin.json 的 args 必须展开 ${ZCODE_PLUGIN_ROOT} 为绝对路径", detail: detail.rewrittenManifest });
    }
    if (!detail.rewrittenManifest.electronRunAsNode) {
      step.failed({ message: "seed 后 plugin.json 必须注入 ELECTRON_RUN_AS_NODE=1", detail: detail.rewrittenManifest });
    }

    // hooks.json 必须已改写：SessionStart command 带 ELECTRON_RUN_AS_NODE + 应用二进制。
    const hooks = await readJsonOrNull(join(ctx.seededRoot, "hooks", "hooks.json"));
    const sessionStartHooks = hooks?.hooks?.SessionStart ?? [];
    /** @type {string[]} */
    const commands = [];
    for (const entry of sessionStartHooks) {
      for (const hook of entry?.hooks ?? []) {
        if (hook?.type === "command" && typeof hook.command === "string") {
          commands.push(hook.command);
        }
      }
    }
    detail.rewrittenHookCommands = commands;
    const hookOk =
      commands.length > 0 &&
      commands.every(
        (commandString) =>
          commandString.includes("ELECTRON_RUN_AS_NODE") &&
          (commandString.includes(basename(appBinary)) || commandString.includes(appBinary)) &&
          !commandString.includes('"${ZCODE_PLUGIN_ROOT}'),
      );
    if (!hookOk) {
      step.failed({ message: "seed 后 hooks.json SessionStart command 必须带 ELECTRON_RUN_AS_NODE 与应用二进制路径", commands });
    }

    // 上游 ~/.zcode（隔离家目录内）必须没被创建/改写（decoy 对照的一部分）。
    const upstreamDir = upstreamZCodeDataDir(ctx.home);
    const upstreamEntries = await directoryEntryNames(upstreamDir);
    detail.upstreamZcodeDataDirEntries = upstreamEntries;
    if (upstreamEntries === null || upstreamEntries.length > 1 || !upstreamEntries.includes(DECOY_MARKER_FILE)) {
      step.failed({
        message: `MOS 不得读写 ${upstreamDir}（发现非 decoy 条目即数据根隔离失败）`,
        entries: upstreamEntries,
      });
    }
    if (recorder.failures.every((failure) => failure.step !== "plugin-seeded")) {
      step.passed({ message: "官方插件缓存 seed + 改写形态 + 数据根隔离断言通过", ...detail });
    }
  });

  // 与插件 loader 的 env overlay 同构（createPluginEnvOverlay：ROOT/DATA/ID/NAME），
  // hook 才能走真实路径而不是仅验证降级分支。
  const pluginOverlayEnv = {
    ZCODE_PLUGIN_ID: MOS_PLUGIN_ID,
    ZCODE_PLUGIN_NAME: MOS_PLUGIN_NAME,
    ZCODE_PLUGIN_ROOT: ctx.seededRoot,
    ZCODE_PLUGIN_DATA: join(mosDataBaseDir(ctx.home), ".zcode", "cli", "data", MOS_PLUGIN_ID),
  };

  // ── 7. plugin-alive：经应用二进制 Node 模式跑通 MCP stdio 握手。 ──
  await recorder.step("plugin-alive", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：MCP 握手未执行（不作验收证据）" });
      return;
    }
    if (!(await pathExists(ctx.seededRoot))) {
      step.degraded({ message: "seed 根不存在（plugin-seeded 失败级联），MCP 握手跳过" });
      return;
    }
    const manifest = await readJsonOrNull(join(ctx.seededRoot, ".zcode-plugin", "plugin.json"));
    const server = manifest?.mcpServers?.studio;
    if (!server || typeof server.command !== "string") {
      step.failed({ message: "seed 后 plugin.json 缺少 mcpServers.studio.command，无法启动插件 MCP" });
      return;
    }
    const handshake = await runMcpHandshake({
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: { ...ctx.env, ...(server.env ?? {}), ...pluginOverlayEnv },
      cwd: workdir,
    });
    const statusView = handshake.toolCall?.structuredContent ?? null;
    const detail = {
      command: server.command,
      args: server.args,
      stage: handshake.stage,
      ok: handshake.ok,
      error: handshake.error ?? null,
      protocolVersion: handshake.protocolVersion ?? null,
      serverInfo: handshake.serverInfo ?? null,
      tools: handshake.tools ?? [],
      statusView,
    };
    if (!handshake.ok) {
      step.failed({
        message: "插件 MCP 握手失败（server 启动/原生模块加载/工具面任一环节）",
        ...detail,
        transcriptTail: handshake.transcript.slice(-20),
      });
      return;
    }
    // 无 provider 连接的降级契约：session=null、availability.reason=session_context_unavailable。
    const degradedSafely =
      statusView !== null &&
      statusView.session === null &&
      typeof statusView.availability === "object" &&
      statusView.availability !== null;
    detail.degradedSafely = degradedSafely;
    if (!degradedSafely) {
      step.failed({ message: "mos_studio_status 未按契约降级（未连接 provider 时必须安全可用）", statusView });
      return;
    }
    step.passed({ message: "initialize + notifications/initialized + tools/list + tools/call(mos_studio_status) 全链路通过", ...detail });
  });

  // ── 8. session-hook：严格按 seed 后命令经 shell 执行（干净机无系统 Node）。 ──
  await recorder.step("session-hook", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：hook 执行未执行（不作验收证据）" });
      return;
    }
    if (!(await pathExists(ctx.seededRoot))) {
      step.degraded({ message: "seed 根不存在（plugin-seeded 失败级联），hook 执行跳过" });
      return;
    }
    const hooks = await readJsonOrNull(join(ctx.seededRoot, "hooks", "hooks.json"));
    const command = hooks?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;
    if (typeof command !== "string") {
      step.failed({ message: "seed 后 hooks.json 缺少 SessionStart command" });
      return;
    }
    const result = await runSessionStartHookCommand({
      platformKey: ctx.platformKey,
      command,
      payload: buildSessionStartHookPayload({
        sessionId: `mos-release-smoke-${Date.now()}`,
        cwd: workdir,
      }),
      cwd: workdir,
      env: { ...ctx.env, ...pluginOverlayEnv },
    });
    const invocation = buildHookInvocation(ctx.platformKey, command);
    const detail = {
      command,
      shell: invocation.shell,
      exitCode: result.code,
      outcome: result.outcome?.outcome ?? null,
      outcomeKnown: HOOK_OUTCOMES.includes(result.outcome?.outcome),
      stderrTail: result.stderr.slice(-2000),
    };
    if (result.code !== 0) {
      step.failed({ message: "SessionStart hook 必须 exit 0（graceful failure 契约）", ...detail, timedOut: result.timedOut });
      return;
    }
    if (result.outcome === null || !detail.outcomeKnown) {
      step.failed({ message: "hook stderr 必须包含 mos-studio 结果 JSON 行", ...detail });
      return;
    }
    step.passed({
      message: `hook 经 shell 执行 exit 0，outcome=${detail.outcome}（干净机链路：应用自带 Electron Node 模式）`,
      ...detail,
    });
  });

  // ── 9. data-persistence/upgrade：marker 回查 + 原地升级（未提供升级包时如实记 skipped）。 ──
  await recorder.step("data-persistence", async (step) => {
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：数据持久化断言未执行（不作验收证据）" });
      return;
    }
    const marker = await readJsonOrNull(ctx.markerPath);
    if (!marker) {
      step.failed({ message: `MOS 数据基座 marker 缺失：${ctx.markerPath}（首启步骤应写入 ~/.mos）` });
      return;
    }
    const userDataDir = electronUserDataDir(ctx.platformKey, ctx.home);
    const userDataFiles = await fileCount(userDataDir);
    step.passed({
      message: "~/.mos marker 与 MOS userData 持久化通过",
      markerPath: ctx.markerPath,
      marker,
      userDataDir,
      userDataFileCount: userDataFiles,
    });
  });

  await recorder.step("upgrade", async (step) => {
    if (!args.upgradeArtifact) {
      step.skipped({ message: "skipped (same-version RC)：同版本 RC 未提供升级包，不做伪造升级" });
      return;
    }
    if (ctx.selfTest) {
      step.skipped({ message: "self-test 桩步骤：升级未执行（不作验收证据）" });
      return;
    }
    const upgradePath = resolve(args.upgradeArtifact);
    if (!(await pathExists(upgradePath))) {
      step.failed({ message: `升级产物不存在：${upgradePath}` });
      return;
    }
    const detail = { upgradeArtifact: upgradePath };
    if (ctx.platformKey.startsWith("linux")) {
      const isRoot = process.getuid?.() === 0;
      const install = await runCapture(
        isRoot ? "dpkg" : "sudo",
        isRoot ? ["-i", upgradePath] : ["-n", "dpkg", "-i", upgradePath],
        { timeoutMs: 600_000 },
      );
      detail.dpkgInstallCode = install.code;
      detail.stderr = install.stderr?.slice(-2000);
      if (install.code !== 0) {
        step.failed({ message: "升级 deb 安装失败", ...detail });
        return;
      }
    } else if (ctx.platformKey.startsWith("mac")) {
      const attach = await runCapture("hdiutil", ["attach", "-plist", "-nobrowse", "-readonly", upgradePath], { timeoutMs: 300_000 });
      const volume = parseHdiutilMountPoints(attach.stdout)[0];
      if (!volume) {
        step.failed({ message: "升级 dmg 挂载失败", stderr: attach.stderr?.slice(-2000) });
        return;
      }
      const copy = await runCapture("ditto", [join(volume, "MOS.app"), join(ctx.installDir)], { timeoutMs: 600_000 });
      await runCapture("xattr", ["-dr", "com.apple.quarantine", ctx.installDir], { timeoutMs: 60_000 });
      await runCapture("hdiutil", ["detach", volume], { timeoutMs: 60_000 });
      detail.dittoCode = copy.code;
      if (copy.code !== 0) {
        step.failed({ message: "升级 MOS.app 覆盖失败", ...detail });
        return;
      }
    } else {
      const install = await runCapture(upgradePath, ["/S"], {
        cwd: dirname(upgradePath),
        env: ctx.env,
        timeoutMs: 900_000,
      });
      detail.nsisInstallCode = install.code;
      if (install.code !== 0) {
        step.failed({ message: "升级 NSIS 静默安装失败", ...detail });
        return;
      }
    }
    // 升级后重启 + marker 回查。
    const primaryBinary = ctx.binaries.deb ?? ctx.binaries.appimage ?? ctx.binaries.app ?? ctx.binaries.exe ?? null;
    if (!primaryBinary || !(await pathExists(primaryBinary))) {
      step.failed({ message: "升级后主二进制缺失，无法重启验收", ...detail });
      return;
    }
    const relaunch = await launchOnce(step, { label: "upgrade-relaunch", binary: primaryBinary, timeoutMs: USER_DATA_TIMEOUT_MS });
    const terminateInfo = await terminateElectronApp(relaunch.launch, { platformKey: ctx.platformKey });
    detail.relaunch = { mode: relaunch.launch.mode, userDataOk: relaunch.userData.ok, terminate: terminateInfo };
    const marker = await readJsonOrNull(ctx.markerPath);
    detail.markerAfterUpgrade = marker;
    if (!relaunch.userData.ok) {
      step.failed({ message: "升级后重启 MOS userData 未就绪", ...detail });
      return;
    }
    if (!marker) {
      step.failed({ message: "升级后 ~/.mos marker 丢失（MOS 数据必须跨升级保留）", ...detail });
      return;
    }
    step.passed({ message: "原地升级 + 重启 + MOS 数据保留断言通过", ...detail });
  });

  // ── 10. upstream-decoys-untouched：上游 ZCode 诱饵终检（所有步骤之后）。 ──
  await recorder.step("upstream-decoys-untouched", async (step) => {
    const results = [];
    for (const decoy of ctx.decoys) {
      const check = await checkDecoyUntouched(decoy);
      results.push({ dir: decoy.dir, mode: decoy.mode, untouched: check.untouched, changes: check.changes });
      if (!check.untouched && decoy.mode === "created-decoy") {
        step.failed({ message: `上游 ZCode decoy 被触碰（数据隔离失败）：${decoy.dir}`, changes: check.changes });
      } else if (!check.untouched) {
        step.degraded({ message: `真实上游目录出现漂移（可能是无关活动；人工复核）：${decoy.dir}`, changes: check.changes });
      }
    }
    if (recorder.failures.every((failure) => failure.step !== "upstream-decoys-untouched")) {
      step.passed({ message: "上游 ZCode 数据目录与 userData decoy 全部未被触碰", decoys: results });
    }
  });

  // 兜底清理：终止所有仍存活的启动句柄（证据已含全部结论，这里只防进程泄漏）。
  for (const launch of ctx.launches) {
    if (launch.child.exitCode === null && launch.child.signalCode === null) {
      await terminateElectronApp(launch, { platformKey: ctx.platformKey });
    }
  }

  return recorder;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const recorder = await runPipeline(args);
  await recorder.write(resolve(args.evidenceOut));
  const summary = {
    schema: SCHEMA,
    platform: args.platform,
    mosVersion: args.mosVersion,
    ok: recorder.ok,
    steps: recorder.steps.map((step) => `${step.name}: ${step.status}`),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!recorder.ok) {
    // 失败步骤的 detail 同步打到 stderr：CI 日志里直接可读（证据 JSON 同时落盘）。
    for (const failure of recorder.failures) {
      const stepRecord = recorder.steps.find((step) => step.name === failure.step);
      const detailText = JSON.stringify(stepRecord?.detail ?? failure.detail, null, 2) ?? "";
      process.stderr.write(`[run-platform-smoke] 步骤 ${failure.step} 失败：\n${detailText.slice(0, 4000)}\n`);
    }
    process.stderr.write(`[run-platform-smoke] 失败步骤：${recorder.failures.map((failure) => failure.step).join(", ")}\n`);
  }
  return recorder.ok ? 0 : 1;
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`[run-platform-smoke] 参数或内部错误：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
