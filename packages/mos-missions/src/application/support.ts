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
