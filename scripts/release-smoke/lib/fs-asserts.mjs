// 文件系统断言原语：必需相对路径缺失清单、非空文件、目录内文件数、目录清单快照
// （上游 ZCode decoy 对照用）。全部返回事实而不是抛错，由调用方决定是 failed 还是 degraded。
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/** 必需相对路径缺失清单（不抛错；missing 为空即全部存在）。 */
export async function missingPaths(root, requiredPaths) {
  const missing = [];
  for (const relative of requiredPaths) {
    try {
      await stat(resolve(root, relative));
    } catch {
      missing.push(relative);
    }
  }
  return missing;
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** 非空文件断言：返回 { exists, size }，size > 0 才算非空。 */
export async function nonEmptyFile(target) {
  try {
    const info = await stat(target);
    return { exists: info.isFile(), size: info.isFile() ? info.size : 0 };
  } catch {
    return { exists: false, size: 0 };
  }
}

/** 可执行位断言（unix；Windows 一律返回 true，由 .exe 扩展名与存在性承担）。 */
export async function executableFile(target, platform = process.platform) {
  try {
    const info = await stat(target);
    if (platform === "win32") return info.isFile();
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * 目录内文件计数（递归、封顶 10000）：Electron userData「至少一个文件」断言用。
 * 目录不存在返回 0。
 */
export async function fileCount(target, cap = 10_000) {
  let count = 0;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (count >= cap) return count;
    if (entry.isFile()) {
      count += 1;
    } else if (entry.isDirectory()) {
      count += await fileCount(join(target, entry.name), cap - count);
    }
  }
  return count;
}

/** 目录直接子项名快照（排序），decoy 对照用；目录不存在返回 null。 */
export async function directoryEntryNames(target) {
  try {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch {
    return null;
  }
}

/** 读文本文件；失败返回 null（而不是抛错，供 lenient 检查记录原始证据）。 */
export async function readFileOrNull(target, encoding = "utf8") {
  try {
    return await readFile(target, encoding);
  } catch {
    return null;
  }
}

/** 读 JSON 文件；解析失败/缺失返回 null。 */
export async function readJsonOrNull(target) {
  const text = await readFileOrNull(target);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
