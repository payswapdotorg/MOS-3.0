// release-smoke 纯逻辑单测：目标机冒烟脚本的重逻辑（安装/启动）在 CI 各平台真实执行，
// 这里只离线锁定可纯函数化的部分 —— MCP 握手帧、hook 载荷/结果解析、平台规格/路径派生、
// 产物名解析、证据记录器。禁止网络/GUI/Electron（node --test，无 npm 依赖）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  buildInitializeRequest,
  buildInitializedNotification,
  buildToolsListRequest,
  buildToolsCallRequest,
  encodeFrame,
  parseJsonRpcLine,
} from "./lib/mcp-handshake.mjs";
import {
  HOOK_OUTCOMES,
  SESSION_START_SOURCE_STARTUP,
  buildHookInvocation,
  buildSessionStartHookPayload,
  parseHookOutcomeLine,
} from "./lib/hook-contract.mjs";
import {
  MOS_APP_ID,
  MOS_PLUGIN_ID,
  MOS_STUDIO_STATUS_TOOL,
  PLATFORM_SPECS,
  artifactExtensionMatchesPlatform,
  artifactFileName,
  buildAgentProcessEnv,
  buildIsolatedEnv,
  electronUserDataDir,
  expectedArtifactFileNames,
  expectedElectronUserDataHome,
  getPlatformSpec,
  keyringPlatformPackageName,
  mosDataBaseDir,
  parseArtifactFileName,
  requiredStudioPluginFiles,
  seededPluginRoot,
  upstreamZCodeDataDir,
} from "./lib/platforms.mjs";
import { sha256File, sha256SumLine } from "./lib/artifact-facts.mjs";
import { createEvidenceRecorder } from "./lib/evidence.mjs";
import {
  debExpectedVersions,
  findNsisPayloadEntry,
  parseDpkgInfo,
  parseSevenZipListing,
  sevenZipListingHasEntries,
} from "./inspect-package.mjs";

test("parseDpkgInfo：真实 dpkg-deb -I 输出形态（控制字段带一个前导空格）", () => {
  // 实测样本（dpkg 1.22，构建机/runner 家族）：首部摘要行不带 Key: 形态，必须被忽略。
  const sample = [
    " new Debian package, version 2.0.",
    " size 660 bytes: control archive=284 bytes.",
    "      91 bytes,     4 lines      control",
    " Package: mos",
    " Version: 3.0.0-rc.1",
    " Maintainer: PaySwap <mos@payswap.org>",
    " Architecture: amd64",
  ].join("\n");
  const info = parseDpkgInfo(sample);
  assert.equal(info.Package, "mos");
  assert.equal(info.Version, "3.0.0-rc.1");
  assert.equal(info.Maintainer, "PaySwap <mos@payswap.org>");
  assert.equal(info.Architecture, "amd64");
  // 非字段行（无 Key: 形态/含逗号）不产生键。
  assert.equal(info.size, undefined);
  assert.equal(Object.keys(info).length, 4);
  // 历史回归：早期正则只匹配 0/2 个前导空格，1 空格形态全字段丢失（CI run 3 实测捕获）。
  assert.notEqual(parseDpkgInfo(" Package: mos").Package, undefined);
});

test("debExpectedVersions：semver 预发布连字符的 Debian ~ 规范化形态（CI run 4 实测捕获）", () => {
  // fpm/electron-builder 打 deb 时把 `-` 规范化为 `~`（dpkg 报 3.0.0-rc.1 → 3.0.0~rc.1）；
  // Debian 语义 `~` 排在发布前，与 semver 预发布一致，两种形态都接受。
  assert.deepEqual(debExpectedVersions("3.0.0-rc.1"), ["3.0.0-rc.1", "3.0.0~rc.1"]);
  assert.deepEqual(debExpectedVersions("3.0.0-rc.2-beta.3"), ["3.0.0-rc.2-beta.3", "3.0.0~rc.2~beta.3"]);
  assert.deepEqual(debExpectedVersions("3.0.0"), ["3.0.0"]);
});

test("parseSevenZipListing：NSIS 顶层无日期/空 Compressed 列的行解析（7-Zip 24.09 实测）", () => {
  // CI run 4 实测捕获：solid NSIS 头多数行无时间戳，旧解析只认带日期行 → listedCount=4。
  const listing = [
    "7-Zip (z) 24.09 (x64) : Copyright (c) 1999-2024 Igor Pavlov : 2024-11-28",
    "",
    "Listing archive: MOS-3.0.0-rc.1-win-x64.exe",
    "--",
    "Path = MOS-3.0.0-rc.1-win-x64.exe",
    "Type = Nsis",
    "SubType = NSIS-3 Unicode",
    "",
    "   Date      Time    Attr         Size   Compressed  Name",
    "------------------- ----- ------------ ------------  ------------------------",
    "                    .....                      6931  $PLUGINSDIR/System.dll",
    "                    .....                      3299  $PLUGINSDIR/nsExec.dll",
    "                    .....                      8018  $PLUGINSDIR/UAC.dll",
    "                    .....                     45608  $PLUGINSDIR/StdUtils.dll",
    "                    .....                      4684  $PLUGINSDIR/nsDialogs.dll",
    "2019-06-17 19:21:30 .....                      1899  modern-wizard.bmp",
    "2026-11-13 21:01:32 .....                      6127  uninstallerIcon.ico",
    "2026-11-13 21:08:20 .....    166173711    166173711  $PLUGINSDIR/app-64.7z",
    "                    .....                     242382  $PLUGINSDIR/nsis7z.dll",
    "2026-11-13 21:08:24 .....                      143365  $R0/Uninstall MOS.exe",
    "                    .....                      1080  $PLUGINSDIR/WinShell.dll",
    "                             166173711    166637104  11 files",
  ].join("\n");
  const entries = parseSevenZipListing(listing);
  assert.equal(entries.length, 11);
  assert.ok(entries.includes("$PLUGINSDIR/app-64.7z"));
  assert.ok(entries.includes("$PLUGINSDIR/System.dll"));
  assert.ok(entries.includes("modern-wizard.bmp"));
  assert.ok(entries.includes("$R0/Uninstall MOS.exe"));
  // 汇总行无属性列，不得入条目。
  assert.ok(!entries.some((e) => e.includes("11 files")));
});

test("parseSevenZipListing：solid 7z payload 视图（目录/文件行均无日期；Name 在行尾）", () => {
  // CI run 4 内层 app-64.7z 实测形态：`....A    246302208               MOS.exe`。
  const listing = [
    "   Date      Time    Attr         Size   Compressed  Name",
    "------------------- ----- ------------ ------------  ------------------------",
    "                    D....            0            0  locales",
    "                    D....            0            0  resources",
    "                    ....A    246302208               MOS.exe",
    "                    ....A    383410660               resources/app.asar",
    "                    ....A      1912832               resources/app.asar.unpacked/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node",
    "                             834151942    166138502  2759 files, 802 folders",
  ].join("\n");
  const entries = parseSevenZipListing(listing);
  assert.equal(entries.length, 5);
  assert.ok(entries.includes("MOS.exe"));
  assert.ok(entries.includes("resources/app.asar"));
  assert.ok(entries.includes("locales"));
  assert.ok(
    entries.includes(
      "resources/app.asar.unpacked/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node",
    ),
  );
  assert.ok(!entries.some((e) => e.includes("2759 files")));
});

test("findNsisPayloadEntry：electron-builder NSIS app payload 惯例定位", () => {
  assert.equal(
    findNsisPayloadEntry(["$PLUGINSDIR/System.dll", "$PLUGINSDIR/app-64.7z", "$R0/Uninstall MOS.exe"]),
    "$PLUGINSDIR/app-64.7z",
  );
  assert.equal(findNsisPayloadEntry(["{app}/app-32.7z"]), "{app}/app-32.7z");
  // 非惯例布局（如未来直接展开 NSIS 条目）→ null，由上层如实报缺失。
  assert.equal(findNsisPayloadEntry(["MOS.exe", "resources/app.asar"]), null);
  assert.equal(findNsisPayloadEntry(["$PLUGINSDIR/nsis7z.dll"]), null);
});

test("sevenZipListingHasEntries：无日期行视图的必需条目匹配（run 4 回归）", () => {
  const listing = [
    "                    ....A    246302208               MOS.exe",
    "                    ....A    383410660               resources/app.asar",
    "                    ....A      1912832               resources/glm/packages/mos-studio-plugin/.zcode-plugin/plugin.json",
  ].join("\n");
  assert.deepEqual(sevenZipListingHasEntries(listing, ["MOS.exe", "resources/app.asar"]).missing, []);
  assert.equal(sevenZipListingHasEntries(listing, ["MOS.exe", "resources/app.asar"]).listedCount, 3);
  assert.deepEqual(
    sevenZipListingHasEntries(listing, ["MOS.exe", "resources/glm/missing.txt"]).missing,
    ["resources/glm/missing.txt"],
  );
  // 反斜杠分隔的 Windows 列表形态归一化后匹配。
  const backslashListing = "                    ....A    246302208               MOS.exe\r\n"
    + "                    ....A    383410660               resources\\app.asar\r\n";
  assert.deepEqual(sevenZipListingHasEntries(backslashListing, ["MOS.exe", "resources/app.asar"]).missing, []);
});

test("MCP 握手帧：initialize → initialized → tools/list → tools/call 与协议版本支持集", () => {
  const init = buildInitializeRequest(1);
  assert.equal(init.jsonrpc, "2.0");
  assert.equal(init.id, 1);
  assert.equal(init.method, "initialize");
  assert.equal(init.params.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.ok(MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(MCP_PROTOCOL_VERSION));
  assert.deepEqual(init.params.capabilities, {});
  const initialized = buildInitializedNotification();
  assert.equal(initialized.method, "notifications/initialized");
  assert.equal("id" in initialized, false);
  const toolsList = buildToolsListRequest(2);
  assert.equal(toolsList.method, "tools/list");
  const call = buildToolsCallRequest(3, MOS_STUDIO_STATUS_TOOL);
  assert.equal(call.params.name, MOS_STUDIO_STATUS_TOOL);
  assert.deepEqual(call.params.arguments, {});
  // ndjson 编码：一行一帧。
  const frame = encodeFrame(init);
  assert.ok(frame.endsWith("\n"));
  assert.equal(frame.trim().split("\n").length, 1);
  // 响应解析：JSON 行 → 对象；空行/非对象/非法行 → null（由调用方计为协议失败）。
  const parsed = parseJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  assert.equal(parsed.id, 1);
  assert.equal(parseJsonRpcLine("not json"), null);
  assert.equal(parseJsonRpcLine("   "), null);
  assert.equal(parseJsonRpcLine(JSON.stringify(42)), null);
});

test("SessionStart hook 载荷镜像 camelCase 主契约 + snake_case 兼容别名", () => {
  const payload = buildSessionStartHookPayload({
    sessionId: "sess-1",
    cwd: "/workspace",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(payload.hookEventName, "SessionStart");
  assert.equal(payload.hook_event_name, "SessionStart");
  assert.equal(payload.sessionId, "sess-1");
  assert.equal(payload.session_id, "sess-1");
  assert.equal(payload.source, SESSION_START_SOURCE_STARTUP);
  // 结果 JSON 行的 outcome 词汇表与真实 hook 契约一致。
  assert.deepEqual(HOOK_OUTCOMES, ["mission_created", "skipped", "sidecar_error", "timeout"]);
});

test("hook 结果行解析：取 stderr 末尾的 mos-studio 结果 JSON；垃圾行被忽略", () => {
  const stderr = [
    "some log line",
    JSON.stringify({ hook: "mos-studio", outcome: "mission_created", sessionId: "s1" }),
  ].join("\n");
  const outcome = parseHookOutcomeLine(stderr);
  assert.equal(outcome.hook, "mos-studio");
  assert.equal(outcome.outcome, "mission_created");
  // 非 JSON 或非 mos-studio 行 → null。
  assert.equal(parseHookOutcomeLine("no json here"), null);
  assert.equal(parseHookOutcomeLine(JSON.stringify({ hook: "other" })), null);
});

test("hook 调用包装：unix 走 sh -c，Windows 走 cmd 且命令字符串原样透传", () => {
  const command = 'ELECTRON_RUN_AS_NODE=1 "/opt/MOS/mos" "a.mjs"';
  const unix = buildHookInvocation("linux-x64", command);
  assert.equal(unix.shell, "/bin/sh");
  assert.deepEqual(unix.args, ["-c", command]);
  const winCommand = 'set "ELECTRON_RUN_AS_NODE=1"&& "MOS.exe" "a.mjs"';
  const win = buildHookInvocation("win-x64", winCommand);
  assert.ok(win.shell.toLowerCase().includes("cmd"));
  assert.deepEqual(win.args, ["/d", "/s", "/c", winCommand]);
});

test("平台规格与身份常量：MOS 独立身份与上游 ZCode 全维度不同", () => {
  const linux = getPlatformSpec("linux-x64");
  assert.equal(linux.os, "linux");
  assert.equal(linux.arch, "x64");
  assert.ok(PLATFORM_SPECS["mac-arm64"]);
  assert.ok(PLATFORM_SPECS["mac-x64"]);
  assert.ok(PLATFORM_SPECS["win-x64"]);
  assert.throws(() => getPlatformSpec("plan9"), /未知平台目标/);
  assert.equal(MOS_APP_ID, "org.payswap.mos");
  assert.equal(MOS_PLUGIN_ID, "mos-studio@zcode-plugins-official");
});

test("产物名契约：MOS-<version>-<platform>-<arch>.<ext>；非契约名返回 null", () => {
  const name = artifactFileName({
    version: "3.0.0-rc.1",
    platformName: "linux",
    arch: "x64",
    extension: "AppImage",
  });
  assert.equal(name, "MOS-3.0.0-rc.1-linux-x64.AppImage");
  const parsed = parseArtifactFileName(name);
  assert.equal(parsed.product, "MOS");
  assert.equal(parsed.version, "3.0.0-rc.1");
  assert.equal(parsed.platform, "linux");
  assert.equal(parsed.arch, "x64");
  assert.equal(parsed.extension, "AppImage");
  assert.equal(parsed.backendSuffix, "");
  // ZCode 形态 / 缺版本 / 未知平台都不是 MOS 产物。
  assert.equal(parseArtifactFileName("ZCode-3.18.0-linux-x64.deb"), null);
  assert.equal(parseArtifactFileName("MOS-linux-x64.AppImage"), null);
  // 各平台必需产物集合形态（linux AppImage+deb、mac dmg+zip、win exe）。
  assert.deepEqual(expectedArtifactFileNames("linux-x64", "3.0.0-rc.1"), [
    "MOS-3.0.0-rc.1-linux-x64.AppImage",
    "MOS-3.0.0-rc.1-linux-x64.deb",
  ]);
  assert.deepEqual(expectedArtifactFileNames("mac-arm64", "3.0.0-rc.1"), [
    "MOS-3.0.0-rc.1-mac-arm64.dmg",
    "MOS-3.0.0-rc.1-mac-arm64.zip",
  ]);
  assert.deepEqual(expectedArtifactFileNames("win-x64", "3.0.0-rc.1"), [
    "MOS-3.0.0-rc.1-win-x64.exe",
  ]);
  assert.equal(artifactExtensionMatchesPlatform("dmg", "linux-x64"), false);
  assert.equal(artifactExtensionMatchesPlatform("AppImage", "linux-x64"), true);
  assert.equal(artifactExtensionMatchesPlatform("exe", "mac-arm64"), false);
});

test("keyring 平台绑定包名映射与目标不匹配失败", () => {
  assert.equal(keyringPlatformPackageName("linux", "x64"), "@napi-rs/keyring-linux-x64-gnu");
  assert.equal(keyringPlatformPackageName("darwin", "arm64"), "@napi-rs/keyring-darwin-arm64");
  assert.equal(keyringPlatformPackageName("win32", "x64"), "@napi-rs/keyring-win32-x64-msvc");
  assert.throws(() => keyringPlatformPackageName("freebsd", "x64"));
});

test("插件必需文件闭包含原生模块（按平台派生 koffi 目标目录）", () => {
  const linuxFiles = requiredStudioPluginFiles("linux-x64");
  assert.ok(linuxFiles.includes(".zcode-plugin/plugin.json"));
  assert.ok(linuxFiles.includes("hooks/hooks.json"));
  assert.ok(linuxFiles.includes("dist/server.mjs"));
  assert.ok(linuxFiles.includes("dist/hook.mjs"));
  assert.ok(linuxFiles.includes("dist/ui/panel.html"));
  assert.ok(linuxFiles.includes("node_modules/koffi/build/koffi/linux_x64/koffi.node"));
  const macFiles = requiredStudioPluginFiles("mac-arm64");
  assert.ok(macFiles.includes("node_modules/@napi-rs/keyring-darwin-arm64/package.json"));
  assert.ok(macFiles.includes("node_modules/koffi/build/koffi/darwin_arm64/koffi.node"));
});

test("数据目录隔离：MOS 与上游 ZCode 的 userData/数据根在所有平台互不相交", () => {
  const home = "/home/tester";
  for (const key of ["linux-x64", "mac-arm64", "win-x64"]) {
    const mosUserData = electronUserDataDir(key, home);
    assert.ok(mosUserData.includes("MOS"), key);
  }
  for (const key of ["linux-x64", "mac-arm64", "win-x64"]) {
    const zcode = upstreamZCodeDataDir(key, home);
    assert.ok(zcode.endsWith(".zcode"), key);
    assert.ok(!zcode.includes(".mos"), key);
  }
  assert.equal(mosDataBaseDir(home), join(home, ".mos"));
  assert.equal(
    seededPluginRoot(home),
    join(
      home,
      ".mos",
      ".zcode",
      "cli",
      "plugins",
      "cache",
      "zcode-plugins-official",
      "mos-studio",
      "0.1.0",
    ),
  );
});

test("agent 子进程环境契约：镜像桌面 buildHostProcessEnv 的 MOS 数据根变量集（run 5 回归）", () => {
  // run 5 实测：seed/MCP/hook 缺 ZCODE_HOME 时，CLI telemetry bootstrap 回落到
  // homedir()/.zcode/v2/telemetry-state.json，把上游 decoy 写花。
  const home = join("/", "smoke", "home");
  const env = buildAgentProcessEnv("linux-x64", home);
  assert.equal(env.ZCODE_HOME, join(home, ".mos", ".zcode"));
  assert.equal(env.ZCODE_DATA_BASE_DIR, join(home, ".mos"));
  assert.equal(env.ZCODE_STORAGE_DIR, join(home, ".mos", ".zcode"));
  assert.equal(env.ZCODE_SESSION_DB_PATH, join(home, ".mos", ".zcode", "cli", "db", "db.sqlite"));
  assert.equal(env.ZCODE_LOG_DIR, join(home, ".mos", ".zcode", "cli", "log"));
  // 契约底线：五个变量全部落在 MOS 数据根（~/.mos）内，无一指向隔离家目录的上游 ~/.zcode。
  for (const value of Object.values(env)) {
    assert.ok(value.startsWith(join(home, ".mos")), `越出 MOS 数据根：${value}`);
  }
});

test("Electron userData 期望家目录：darwin 用真实家目录，其它平台用隔离家目录", () => {
  // run 5 实测：mac 的 Chromium 解析 appData 不跟随 HOME 环境覆盖，首启 userData
  // 始终落在真实家目录 ~/Library/Application Support/MOS。
  const isolated = join("/", "smoke", "work", "home");
  const real = join("/", "Users", "runner");
  assert.equal(expectedElectronUserDataHome("mac-arm64", isolated, real), real);
  assert.equal(expectedElectronUserDataHome("mac-x64", isolated, real), real);
  assert.equal(expectedElectronUserDataHome("win-x64", isolated, real), isolated);
  assert.equal(expectedElectronUserDataHome("linux-x64", isolated, real), isolated);
});

test("隔离运行环境：HOME/APPDATA 等全部指向隔离家目录，TMPDIR 保留系统值", () => {
  const home = "/isolated/home";
  const env = buildIsolatedEnv("linux-x64", home, { HOME: "/real/home", PATH: "/usr/bin" });
  assert.equal(env.HOME, home);
  assert.equal(env.PATH, "/usr/bin");
  const winEnv = buildIsolatedEnv("win-x64", home, { USERPROFILE: "C:\\Users\\real" });
  assert.equal(winEnv.USERPROFILE, home);
  assert.ok(winEnv.APPDATA.endsWith(join("AppData", "Roaming")));
});

test("sha256 流式计算与 sha256sum 行格式（对已知向量）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-lib-"));
  try {
    const file = join(dir, "a.bin");
    writeFileSync(file, Buffer.from("abc"));
    const digest = await sha256File(file);
    // "abc" 的 SHA-256 已知向量。
    assert.equal(
      digest,
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(sha256SumLine({ file: "a.bin", sha256: digest }), `${digest}  a.bin`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("证据记录器：failed 粘滞、异常折算、JSON 落盘与 ok 汇总", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-evidence-"));
  try {
    const recorder = createEvidenceRecorder({ schema: "test-schema@1", meta: { platform: "linux-x64" } });
    await recorder.step("good-step", async (step) => {
      step.passed({ detail: "ok" });
    });
    await recorder.step("skipped-step", async (step) => {
      step.skipped("same-version RC");
    });
    await recorder.step("throwing-step", async () => {
      throw new Error("boom");
    });
    const outPath = join(dir, "evidence.json");
    await recorder.write(outPath);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.schema, "test-schema@1");
    assert.equal(written.platform, "linux-x64");
    assert.equal(written.ok, false);
    assert.equal(recorder.ok, false);
    const byName = new Map(written.steps.map((step) => [step.name, step]));
    assert.equal(byName.get("good-step").status, "passed");
    assert.equal(byName.get("skipped-step").status, "skipped");
    // 抛错步骤被折算为 failed 且 failures 含步骤名。
    assert.equal(byName.get("throwing-step").status, "failed");
    assert.ok(written.failures.some((failure) => failure.step === "throwing-step"));
    assert.ok(String(JSON.stringify(byName.get("throwing-step").detail)).includes("boom"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
