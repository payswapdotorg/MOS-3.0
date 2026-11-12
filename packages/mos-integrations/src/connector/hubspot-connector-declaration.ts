import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { InvariantViolation, parseOrFail } from "@mos/contracts";
import { hubspotProviderDescriptor } from "../contract/hubspot-descriptor.js";

/**
 * 可安装 connector 声明的加载器（contract-level 模板，未接入任何应用）。
 *
 * strategy §4 的硬约束：不得改动 ZCode 的 plugin.json manifest schema 来塞
 * 营销字段。因此：
 * - 模板文件只使用 @zcode/contracts `PluginManifest` 的既有字段
 *   （name/version/description/mcpServers/...，见 ZCODE_PLUGIN_MANIFEST_KEYS）；
 * - MOS 的 provider/capability 元数据放在本包的描述符文件里，版本独立；
 * - 本加载器 fail-closed：出现任何 manifest 之外的字段直接抛
 *   InvariantViolation，证明"模板不改 manifest schema"是可机检的约定。
 *
 * 模板本身 NOT wired：组合根（TL 所有）将来决定是否安装；安装也不等于
 * 任何外部动作授权（strategy §4 / AGENTS.md §4）。
 */

/** ZCode plugin.json（@zcode/contracts PluginManifest）的既有顶层字段集合。 */
export const ZCODE_PLUGIN_MANIFEST_KEYS = [
  "agents",
  "author",
  "channels",
  "commands",
  "dependencies",
  "description",
  "homepage",
  "hooks",
  "keywords",
  "license",
  "lspServers",
  "mcpServers",
  "name",
  "outputStyles",
  "repository",
  "settings",
  "skills",
  "ui",
  "userConfig",
  "version",
] as const;

const ZCODE_MANIFEST_KEY_SET: ReadonlySet<string> = new Set(ZCODE_PLUGIN_MANIFEST_KEYS);

/**
 * mcpServers 条目 schema：形状刻意贴近 @zcode/adapters 的
 * mcpHttpServerSchema / mcpStdioServerSchema / mcpSseServerSchema
 * （stdio: command 必填；http/sse: url 必填；oauth 二选一）。
 */
export const connectorMcpServerEntrySchema = z.object({
  type: z.enum(["stdio", "http", "sse"]),
  url: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().optional(),
  oauth: z
    .object({
      type: z.enum(["authorization_code", "client_credentials"]),
      clientId: z.string().min(1).optional(),
      clientSecret: z.string().min(1).optional(),
      clientName: z.string().min(1).optional(),
      redirectPath: z.string().min(1).optional(),
      scope: z.string().optional(),
    })
    .optional(),
});
export type ConnectorMcpServerEntry = z.infer<typeof connectorMcpServerEntrySchema>;

/**
 * connector 模板 manifest schema（passthrough：多余键不静默剥离，
 * 而是交给下方 fail-closed 字段白名单检查）。
 */
export const connectorTemplateManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  mcpServers: z.record(z.string(), connectorMcpServerEntrySchema),
});
export type ConnectorTemplateManifest = z.infer<typeof connectorTemplateManifestSchema>;

/** 已解析、已通过白名单与 HubSpot 一致性校验的 connector 模板。 */
export interface HubSpotConnectorTemplate {
  readonly manifest: ConnectorTemplateManifest;
  /** 相对 connector 模板根目录的 manifest 路径（与 ZCode loader 约定一致）。 */
  readonly manifestPath: ".zcode-plugin/plugin.json";
  readonly serverName: "hubspot";
  /** 模板未接入应用：类型层面就是 false，禁止把模板当作已安装能力。 */
  readonly installed: false;
}

/**
 * 解析并校验 connector 模板 manifest：
 * 1. 结构校验（connectorTemplateManifestSchema，fail-closed 抛 ContractValidationError）；
 * 2. 字段白名单校验（不得携带 ZCode plugin manifest 之外的任何字段）；
 * 3. HubSpot 一致性校验（server 名、http endpoint、authorization_code OAuth，
 *    与 provider 描述符完全一致——模板不得声明描述符之外的端点）。
 */
export function parseConnectorTemplateManifest(raw: unknown): ConnectorTemplateManifest {
  const manifest = parseOrFail(
    "ConnectorTemplateManifest",
    connectorTemplateManifestSchema,
    raw,
  );
  assertWithinZcodeManifestSchema(raw);
  return manifest;
}

/** fail-closed：模板不得改动/扩写 ZCode plugin manifest schema。 */
function assertWithinZcodeManifestSchema(raw: unknown): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const unknownKeys = Object.keys(raw).filter((key) => !ZCODE_MANIFEST_KEY_SET.has(key));
  if (unknownKeys.length > 0) {
    throw new InvariantViolation(
      "zcode-plugin-manifest-unchanged",
      `connector 模板携带了 ZCode plugin manifest 之外的字段: ${unknownKeys.join(", ")}`,
    );
  }
}

/** fail-closed：模板声明的 HubSpot server 必须与 provider 描述符一致。 */
function assertHubSpotDeclaration(manifest: ConnectorTemplateManifest): void {
  const server = manifest.mcpServers["hubspot"];
  if (server === undefined) {
    throw new InvariantViolation("connector-descriptor-consistency", "缺少 hubspot mcpServers 条目");
  }
  if (server.type !== "http" || server.url !== hubspotProviderDescriptor.endpoint.url) {
    throw new InvariantViolation(
      "connector-descriptor-consistency",
      `hubspot server 声明与 provider 描述符不一致: ${server.type} ${server.url ?? "<missing url>"}`,
    );
  }
  if (server.oauth === undefined || server.oauth.type !== "authorization_code") {
    throw new InvariantViolation(
      "connector-descriptor-consistency",
      "hubspot server 必须声明 oauth.authorization_code（对应描述符 authMethod=oauth_authorization_code）",
    );
  }
}

/**
 * 从磁盘加载 HubSpot connector 模板（目录注入；模板未被任何应用接线）。
 * 组合根将来若安装，也必须走 ZCode 自己的插件安装/启用流程（strategy §4）。
 */
export async function loadHubSpotConnectorTemplate(
  rootDirectory: string,
): Promise<HubSpotConnectorTemplate> {
  const manifestPath = join(rootDirectory, ".zcode-plugin", "plugin.json");
  let rawText: string;
  try {
    rawText = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new InvariantViolation(
        "connector-template-missing",
        `connector 模板缺少 manifest: ${manifestPath}`,
      );
    }
    throw error;
  }
  const manifest = parseConnectorTemplateManifest(JSON.parse(rawText) as unknown);
  assertHubSpotDeclaration(manifest);
  return {
    manifest,
    manifestPath: ".zcode-plugin/plugin.json",
    serverName: "hubspot",
    installed: false,
  };
}
