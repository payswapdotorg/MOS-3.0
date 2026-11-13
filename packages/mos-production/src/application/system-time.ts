import type { TimePort } from "../contract.js";

/**
 * 系统时钟默认实现（RFC3339 UTC：toISOString 以 Z 结尾，符合 rfc3339TimestampSchema）。
 * 组合根可注入任意结构兼容的时钟（TimePort），测试可注入可变时钟。
 */
export class SystemTimePort implements TimePort {
  now(): string {
    return new Date().toISOString();
  }
}
