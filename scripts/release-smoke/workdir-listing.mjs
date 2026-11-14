#!/usr/bin/env node
// workdir-listing —— 冒烟工作区文件清单（路径+大小）。
//
// 用途：release workflow 的 smoke 证据工件只携带证据 JSON 与这份清单，
// 不再上传几百 MB 的安装目录/隔离家目录本体（run 5 实测每平台 250-490MB）；
// 内容需要取证时按 runbook 复现。BSD find（mac runner）没有 -printf，
// 这里用纯 Node 保证三平台一致输出。
//
// 用法：node scripts/release-smoke/workdir-listing.mjs <dir>
// 目录不存在时向 stderr 报错并以非零退出（调用方按缺省文案落盘）。
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.argv[2];
if (!root) {
  process.stderr.write("用法：node workdir-listing.mjs <dir>\n");
  process.exit(2);
}

try {
  const lines = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      try {
        const size = statSync(path).size;
        lines.push([String(size).padStart(10), path]);
      } catch {
        // 单个文件消失（安装器清理自身）不阻断整份清单。
      }
    }
  };
  walk(root);
  lines.sort((a, b) => a[1].localeCompare(b[1]));
  if (lines.length === 0) {
    process.stdout.write(`(${basename(root)} 存在但为空)\n`);
  } else {
    process.stdout.write(lines.map(([size, path]) => `${size}  ${path}`).join("\n") + "\n");
  }
} catch (error) {
  process.stderr.write(`workdir-listing: 无法读取 ${root}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
