// 产物事实：sha256（流式）+ 尺寸。供 inspect-package（构建机）与 run-platform-smoke
// （目标机 verify-artifact 步骤）共用；两次实现只会让 digest 证据分叉。
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

/** 流式计算文件 sha256（安装包数百 MB，不能一次读进内存）。 */
export async function sha256File(filePath) {
  const hash = createHash("sha256");
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/** 产物事实记录（file 为 basename，便于跨机器对账；path 为绝对路径）。 */
export async function artifactFacts(filePath) {
  const absolute = resolve(filePath);
  const info = await stat(absolute);
  return {
    file: basename(absolute),
    path: absolute,
    sizeBytes: info.size,
    sha256: await sha256File(absolute),
  };
}

/** SHA256SUMS 行（`<hex>  <file>`，与 coreutils sha256sum 输出兼容）。 */
export function sha256SumLine(facts) {
  return `${facts.sha256}  ${facts.file}`;
}
