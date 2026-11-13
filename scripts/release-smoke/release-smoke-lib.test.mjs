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
  jsonRpcNotification,
  jsonRpcRequest,
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
  buildIsolatedEnv,
  electronUserDataDir,
  expectedArtifactFileNames,
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
    join(home, ".mos", ".zcode", "cli", "cache", "zcode-plugins-official", "mos-studio", "0.1.0"),
  );
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
