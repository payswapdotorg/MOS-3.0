import type { ProviderContentBlock, ProviderToolCallResult } from "@mos/adapters";
import type { ProviderReadShape } from "../contract/read-adapter.js";

/**
 * 纯函数：把 provider 工具结果压缩成"计数 + 形状"摘要。
 * 绝不内嵌任何记录值（AGENTS.md §4：个人数据/客户记录不进日志、证据、测试）。
 * 未知 → null（core-contracts 未知值约定），绝不猜值。
 *
 * record_count 的取数口径在 recordCountBasis 中显式声明（可审计的形状启发式）：
 * - "structured_content"：MCP 结构化结果里的主记录数组（结果本身是数组时取自身；
 *   是对象时取第一个值为数组的自有属性——插入序，确定性）；
 * - "text_json"：无结构化结果时，首个 text 块按 JSON 解析成功后的同规则计数；
 * - null：两种口径都取不到 → recordCount 为 null。
 */

const MAX_SUMMARY_FIELDS = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function topKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).slice(0, MAX_SUMMARY_FIELDS);
}

interface ExtractedRecords {
  readonly records: readonly unknown[];
  /** 主记录数组所在对象的顶层键（只有记录取自嵌套对象时才有值）。 */
  readonly topLevelKeys: readonly string[] | null;
}

/** 记录数组候选：直接数组，或对象里第一个值为数组的自有属性（确定性：插入序第一个）。 */
function extractRecordArray(value: unknown): ExtractedRecords | null {
  if (Array.isArray(value)) {
    return { records: value, topLevelKeys: null };
  }
  if (isPlainObject(value)) {
    for (const property of Object.values(value)) {
      if (Array.isArray(property)) {
        return { records: property, topLevelKeys: topKeys(value) };
      }
    }
  }
  return null;
}

/** 只在 text 块解析成 JSON 且含记录数组时取数；解析失败 → null（不猜）。 */
function extractRecordsFromText(
  content: readonly ProviderContentBlock[],
): ExtractedRecords | null {
  for (const block of content) {
    if (typeof block.text !== "string" || block.text.length === 0) continue;
    try {
      return extractRecordArray(JSON.parse(block.text) as unknown);
    } catch {
      continue;
    }
  }
  return null;
}

export function summarizeProviderReadResult(result: ProviderToolCallResult): ProviderReadShape {
  const contentBlockTypes: string[] = [];
  for (const block of result.content) {
    const type =
      typeof block.type === "string" && block.type.length > 0 ? block.type : "unknown";
    if (!contentBlockTypes.includes(type)) contentBlockTypes.push(type);
  }

  let extracted: ExtractedRecords | null = null;
  let recordCountBasis: "structured_content" | "text_json" | null = null;
  let structuredContentKeys: readonly string[] | null = null;

  if (result.structuredContent === null || result.structuredContent === undefined) {
    extracted = extractRecordsFromText(result.content);
    if (extracted) recordCountBasis = "text_json";
  } else {
    extracted = extractRecordArray(result.structuredContent);
    if (extracted) {
      recordCountBasis = "structured_content";
      structuredContentKeys = extracted.topLevelKeys;
    } else if (isPlainObject(result.structuredContent)) {
      // 无记录数组：仍给出顶层键形状，recordCount 保持 null（不猜）。
      structuredContentKeys = topKeys(result.structuredContent);
    }
  }

  const firstRecord = extracted !== null && extracted.records.length > 0 ? extracted.records[0] : undefined;
  const recordFields = isPlainObject(firstRecord) ? topKeys(firstRecord) : null;

  return {
    recordCount: extracted !== null ? extracted.records.length : null,
    recordCountBasis,
    contentBlockCount: result.content.length,
    contentBlockTypes,
    structuredContentKeys,
    recordFields,
  };
}
