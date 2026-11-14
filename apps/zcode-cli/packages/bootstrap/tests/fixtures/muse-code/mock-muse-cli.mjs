#!/usr/bin/env node
// 模拟 muse CLI（Issue #24 契约测试专用；不是真实 Meta CLI）。
// 解析 documented 调用形状：`exec --json --prompt-file <file> [--max-model-steps N]`，
// 按 MUSE_FIXTURE_MODE 输出候选 JSONL 事件流：
//   stream（默认）| exit-fail | error-event | invalid | hang | write-file
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
const maxStepsIndex = argv.indexOf("--max-model-steps");
if (promptFileIndex === -1) {
  process.stderr.write("fixture: --prompt-file missing\n");
  process.exit(2);
}
let prompt;
try {
  prompt = readFileSync(argv[promptFileIndex + 1], "utf8");
} catch {
  process.stderr.write("fixture: cannot read prompt file\n");
  process.exit(2);
}
const maxModelSteps = maxStepsIndex !== -1 ? argv[maxStepsIndex + 1] : undefined;
const mode = process.env.MUSE_FIXTURE_MODE ?? "stream";
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

if (mode === "fail-start") {
  process.exit(127);
}
// 未映射的事件类型：真实 CLI 的 schema 未知，端口必须计数而不是猜测。
emit({ type: "system", promptFile: true, maxModelSteps });
if (mode === "write-file") {
  writeFileSync(join(process.cwd(), "muse-fixture-marker.txt"), "written-by-muse\n");
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
