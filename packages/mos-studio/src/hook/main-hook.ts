/**
 * hook 进程入口（dist/hook.mjs；hooks/hooks.json 指向这里）。
 * 读 stdin 的 SessionStart payload → runSessionStartHook（graceful failure，恒 exit 0）。
 * 任何路径都不抛出、不阻塞标准任务路径（onError=allow 双保险）。
 */
import { runSessionStartHook, readStdinFully } from "./main.js";

try {
  const stdin = await readStdinFully();
  await runSessionStartHook(stdin);
} catch (error) {
  process.stderr.write(
    `mos-studio hook unexpected failure: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
process.exit(0);
