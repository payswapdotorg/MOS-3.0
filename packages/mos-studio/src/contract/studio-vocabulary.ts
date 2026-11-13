/**
 * mos-studio 词汇表：工具名、资源 URI、凭据键与常量。
 * 与 ZCode 插件清单（.zcode-plugin/plugin.json）字面一致的部分由 test/manifest.test.ts 机器校验。
 */

/** MCP server 名（= 清单 mcpServers 键）。 */
export const STUDIO_SERVER_NAME = "studio";

/** 面板资源 URI（= 清单 ui.surfaces[].resourceUri）。 */
export const STUDIO_PANEL_URI = "ui://mos-studio/panel.html";
export const STUDIO_PANEL_MIME = "text/html;profile=mcp-app";

/** 插件数据文件名（均在 $ZCODE_PLUGIN_DATA 下）。 */
export const OPERATOR_STORE_FILENAME = "mos-operator.json";

/** Composio x-api-key 在真实 ZCode 凭据存储中的不透明键（credential_ref）。 */
export const COMPOSIO_CREDENTIAL_REF = "mcp:apikey:composio-studio:header";

/** Composio 连接 id（每 tenant 单连接，确定性 upsert）。 */
export const COMPOSIO_CONNECTION_ID = "conn:composio";

/** 组合根声明的能力/实现（数据来源：spec/integrations/provider-evidence/composio-connector-evidence.md，W2 live 观测）。 */
export const STUDIO_COMPOSIO_CAPABILITY_ID = "research.discussion.search";
export const STUDIO_COMPOSIO_DESCRIPTOR_ID = "desc-composio-discussion-search";
export const STUDIO_COMPOSIO_IMPLEMENTATION_ID = "impl-composio-discussion-search";

// 工具名（清单不声明工具；server 在 tools/list 里给出）。
export const MOS_STUDIO_STATUS_TOOL = "mos_studio_status";
export const MOS_SET_OPERATOR_TOOL = "mos_set_operator";
export const MOS_LIST_MISSIONS_TOOL = "mos_list_missions";
export const MOS_RECORD_MISSION_INTAKE_TOOL = "mos_record_mission_intake";
export const MOS_CONNECT_COMPOSIO_TOOL = "mos_connect_composio";
export const MOS_CAPABILITIES_TOOL = "mos_capabilities";
export const MOS_ROUTES_TOOL = "mos_routes";
export const MOS_EXECUTE_AUTHORIZED_READ_TOOL = "mos_execute_authorized_read";

/** 授权读的参数与返回上限（保守值；面板与模型共享）。 */
export const READ_QUERY_MAX_LENGTH = 500;
export const READ_LIMIT_MIN = 1;
export const READ_LIMIT_MAX = 20;
export const READ_LIMIT_DEFAULT = 5;
export const READ_TIMEOUT_MS = 60_000;
export const SESSION_FACTORY_TIMEOUT_MS = 30_000;

/** Hook 侧（SessionStart source=startup 才视为新任务首回合）。 */
export const SESSION_START_SOURCE_STARTUP = "startup";

/** 面板 app-only 工具可见性（模型工具列表不出现；面板调用不受影响）。 */
export const APP_ONLY_VISIBILITY = { ui: { visibility: ["app"] } } as const;
