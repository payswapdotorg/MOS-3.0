#!/usr/bin/env node
// 模拟 muse CLI（Issue #24 契约测试专用；不是真实 Meta CLI）。
// 解析 documented 调用形状（评审 rev. 3 增加 --workspace；MC-D 验证轮增加 --model）：
//   `exec --json --workspace <path> --prompt-file <file> [--model <id>]
//   [--max-model-steps N] [--session-id <uuid>] [--disable-approval]`，
// 按 MUSE_FIXTURE_MODE 输出候选 JSONL 事件流：
//   stream（默认）| exit-fail | error-event | invalid | hang | write-file
//   | env-audit | argv-audit | approval-event | question-event
// PR #27 评审修订：
//   - workspace 边界（R4 rev. 3）：--workspace 是 Meta 当前配置文档列出的
//     common flag（interactive/headless 通用），fixture 按契约形状强制要求它。
//   - 会话连续性（R2）：无 --session-id 时申报 session_started + session_id；
//     带调用方提供的 --session-id 时申报 session_resumed。
//   - 审批可见性（R3）：approval-event / question-event 模式发出候选事件。
//   - 环境隔离（R5）：env-audit 把子进程环境键写盘（只键名，不写值）。
//   - argv 审计：argv-audit 把收到的 argv 逐行写盘（核对 --workspace /
//     --disable-approval / --session-id / --model 是否按设置传入）。
// MC-D 验证轮（TL correction round 2026-11-15）：
//   - --model <id> 是 documented 旗标（与 --workspace/--session-id 同页）：present
//     时按 fixture 目录（muse-spark-1.3-contributor / muse-spark-1.4-contributor）
//     校验；未知 id → stderr + 非零退出（真实 CLI 拒绝未知模型的可见失败模拟）。
//   - **绝不解析/接受 --contributor-mode**（MOS 永不传；用户 CLI 配置自治）。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const argv = process.argv.slice(2);

if (argv[0] === "--version") {
  process.stdout.write("muse version 1.2.3-fixture\n");
  process.exit(0);
}
if (argv[0] !== "exec" || argv[1] !== "--json") {
  process.stderr.write("fixture: expected 'exec --json'\n");
  process.exit(2);
}
const promptFileIndex = argv.indexOf("--prompt-file");
const workspaceIndex = argv.indexOf("--workspace");
const maxStepsIndex = argv.indexOf("--max-model-steps");
const sessionIdIndex = argv.indexOf("--session-id");
const modelIndex = argv.indexOf("--model");
if (promptFileIndex === -1) {
  process.stderr.write("fixture: --prompt-file missing\n");
  process.exit(2);
}
if (workspaceIndex === -1) {
  process.stderr.write("fixture: --workspace missing\n");
  process.exit(2);
}
let prompt;
try {
  prompt = readFileSync(argv[promptFileIndex + 1], "utf8");
} catch {
  process.stderr.write("fixture: cannot read prompt file\n");
  process.exit(2);
}
if (argv.includes("--contributor-mode")) {
  // MOS 绝不传该旗标（用户 CLI 配置自治）；出现即调用方违规。
  process.stderr.write("fixture: --contributor-mode must never be passed\n");
  process.exit(2);
}
const workspaceRoot = argv[workspaceIndex + 1];
const maxModelSteps = maxStepsIndex !== -1 ? argv[maxStepsIndex + 1] : undefined;
const resumeSessionId = sessionIdIndex !== -1 ? argv[sessionIdIndex + 1] : undefined;
const modelId = modelIndex !== -1 ? argv[modelIndex + 1] : undefined;
const FIXTURE_MODEL_CATALOG = ["muse-spark-1.3-contributor", "muse-spark-1.4-contributor"];
if (modelId !== undefined && !FIXTURE_MODEL_CATALOG.includes(modelId)) {
  // 真实 CLI 拒绝未知模型的可见失败模拟（非零退出 + stderr；端口如实回传）。
  process.stderr.write(`fixture: unknown model '${modelId}'\n`);
  process.exit(4);
}
const mode = process.env.MUSE_FIXTURE_MODE ?? "stream";
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

if (mode === "fail-start") {
  process.exit(127);
}
if (mode === "env-audit") {
  // 只写键名（R5 断言用）；绝不写值——fixture 自身也不携带敏感值。
  writeFileSync(
    join(process.cwd(), "muse-fixture-env.txt"),
    `${Object.keys(process.env).sort().join("\n")}\n`,
  );
  process.exit(0);
}
if (mode === "argv-audit") {
  writeFileSync(join(process.cwd(), "muse-fixture-argv.txt"), `${argv.join("\n")}\n`);
  process.exit(0);
}
// 未映射的事件类型：真实 CLI 的 schema 未知，端口必须计数而不是猜测。
emit({ type: "system", promptFile: true, workspaceRoot, maxModelSteps, modelId });
// 会话申报（R2）：候选信封字段；端口负责捕获（未知类型按 unknown 计数）。
emit(
  resumeSessionId
    ? { type: "session_resumed", session_id: resumeSessionId }
    : { type: "session_started", session_id: "muse-fixture-session-1" },
);
if (mode === "write-file") {
  writeFileSync(join(process.cwd(), "muse-fixture-marker.txt"), "written-by-muse\n");
}
if (mode === "approval-event") {
  emit({ type: "approval_request", toolName: "Bash", message: "run the test suite" });
}
if (mode === "question-event") {
  emit({ type: "user_question", question: "Which database engine should I use?" });
}
emit({ type: "assistant_text_delta", text: `Working on: ${prompt.slice(0, 24)}` });
emit({ type: "tool_call", toolName: "Read", toolCallId: "tc-1" });
await sleep(Number(process.env.MUSE_FIXTURE_DELAY_MS ?? 20));
emit({ type: "tool_result", toolCallId: "tc-1", status: "ok", summary: "read 12 lines" });
emit({ type: "assistant_text_delta", text: " done." });
emit({ type: "assistant_text_end" });
if (mode === "invalid") {
  process.stdout.write("this line is not json\n");
}
if (mode === "exit-fail") {
  process.stderr.write("fixture simulated failure detail\n");
  process.exit(3);
}
if (mode === "error-event") {
  emit({ type: "error", message: "fixture runtime error", code: "FIXTURE_ERROR" });
  process.exit(0);
}
if (mode === "hang") {
  emit({ type: "assistant_text_delta", text: "still working" });
  await sleep(120_000);
  process.exit(0);
}
emit({ type: "result", status: "ok" });
process.exit(0);
