/**
 * 工具名合成/解析：与 ZCode `mcp__<server>__<tool>` 规则一致。
 * 去掉两侧下划线后拼接；解析按第一个 `mcp__` 前缀与 `__` 分隔符。
 */

const SANITIZE = /^mcp__|[^a-zA-Z0-9_-]/g;

export function sanitizeMcpNamePart(part: string): string {
  return part.replace(SANITIZE, "_");
}

export function toProviderToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeMcpNamePart(serverName)}__${sanitizeMcpNamePart(toolName)}`;
}

export function parseProviderToolName(
  canonicalName: string,
): { serverName: string; toolName: string } | null {
  if (!canonicalName.startsWith("mcp__")) return null;
  const rest = canonicalName.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return null;
  const serverName = rest.slice(0, separator);
  const toolName = rest.slice(separator + 2);
  if (serverName.length === 0 || toolName.length === 0) return null;
  return { serverName, toolName };
}

/** operation_mapping 的 tool_name 是否与某个 descriptor 对得上（精确字符串匹配，无模糊）。 */
export function findDescriptorForToolName(
  descriptors: ReadonlyArray<{ serverName: string; toolName: string }>,
  toolName: string,
): { serverName: string; toolName: string } | null {
  const exact = descriptors.find(
    (descriptor) => descriptor.toolName === toolName || toProviderToolName(descriptor.serverName, descriptor.toolName) === toolName,
  );
  return exact ?? null;
}
