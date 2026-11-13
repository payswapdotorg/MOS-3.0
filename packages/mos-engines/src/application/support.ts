/**
 * application 层内部小工具（不经 index.ts 公开）。
 * describeError 只做异常到字符串的安全降级，绝不打印/外发（无 console）。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name;
  }
  return String(error);
}

/**
 * 受 schema 约束的值域深比较（null / 原始值 / 数组 / 浅层对象树），
 * 供注册表“内容未变则不 bump 版本”的幂等判断使用；键序无关。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA);
  const keysB = Object.keys(recordB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(recordB, key) &&
      deepEqual(recordA[key], recordB[key]),
  );
}
