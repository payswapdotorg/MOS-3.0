/**
 * SHA-256 校验工具（流式，1MB 分块）。
 *
 * 发布链路对数百 MB 的安装包做两次哈希（生成 SHA256SUMS + 发布前终验），
 * 一次性 readFile 会把内存峰值抬到产物体积，流式读取保证恒定内存。
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";

export const SHA256_CHUNK_BYTES = 1024 * 1024;

/** 流式计算单个文件的 SHA-256（hex 小写）。 */
export async function sha256File(filePath, { chunkSizeBytes = SHA256_CHUNK_BYTES } = {}) {
  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new Error(`非法分块大小：${chunkSizeBytes}`);
  }
  const hash = createHash("sha256");
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(chunkSizeBytes);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSizeBytes, null);
      if (bytesRead === 0) break;
      hash.update(bytesRead === chunkSizeBytes ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/**
 * 生成 sha256sum 兼容清单文本：每行 `<hex>  <filename>`（两个空格，POSIX sha256sum -c 可校验）。
 * entries 为 { path, filename? } 或裸路径字符串；filename 缺省取 basename(path)。
 * 行序保持调用方顺序（排序由调用方决定，保证输出可复现）。
 */
export async function generateSha256sums(entries) {
  const lines = [];
  for (const entry of entries) {
    const filePath = typeof entry === "string" ? entry : entry.path;
    const filename =
      (typeof entry === "string" ? undefined : entry.filename) ?? basename(filePath);
    lines.push(`${await sha256File(filePath)}  ${filename}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 解析 sha256sum 文本为 [{ sha256, filename }]；非法行直接抛错（宁可失败不可误判）。 */
export function parseSha256sums(text) {
  const entries = [];
  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    if (!match) throw new Error(`SHA256SUMS 行格式不合法（期望 "<hex>  <filename>"）：${rawLine}`);
    entries.push({ sha256: match[1], filename: match[2] });
  }
  return entries;
}
