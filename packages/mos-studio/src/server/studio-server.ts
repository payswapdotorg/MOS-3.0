import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MOS_CAPABILITIES_TOOL,
  MOS_COMPOSE_DRAFT_BRIEF_TOOL,
  MOS_CONNECT_COMPOSIO_TOOL,
  MOS_EXECUTE_AUTHORIZED_READ_TOOL,
  MOS_LIST_DRAFT_BRIEFS_TOOL,
  MOS_LIST_EVIDENCE_TOOL,
  MOS_LIST_HYPOTHESES_TOOL,
  MOS_LIST_MISSIONS_TOOL,
  MOS_LIST_RESEARCH_NOTES_TOOL,
  MOS_PROPOSE_HYPOTHESIS_TOOL,
  MOS_RECORD_MISSION_INTAKE_TOOL,
  MOS_RECORD_RESEARCH_NOTE_TOOL,
  MOS_REVIEW_DRAFT_BRIEF_TOOL,
  MOS_ROUTES_TOOL,
  MOS_SET_OPERATOR_TOOL,
  MOS_STUDIO_STATUS_TOOL,
  STUDIO_PANEL_MIME,
  STUDIO_PANEL_URI,
} from "../contract/studio-vocabulary.js";
import { sessionFactsFromToolCallMeta } from "../contract/session-context.js";
import {
  StudioBriefNotFoundError,
  StudioConnectionNotFoundError,
  StudioDataDirUnavailableError,
  StudioEvidenceNotFoundError,
  StudioHypothesisNotFoundError,
  StudioInvalidInputError,
  StudioMissionNotFoundError,
  StudioNoteNotFoundError,
  StudioTenantUnavailableError,
  studioSessionContextFromMeta,
  type StudioService,
} from "../application/studio-service.js";
import { STUDIO_TOOLS } from "./tools.js";

/**
 * mos-studio MCP server（stdio）：面板资源 + 旅程工具。
 * 会话事实只从 tools/call `_meta` 读取（模型与面板调用都会注入）；缺失即缺失。
 * 业务失败一律 isError 结构化返回（面板可读）；协议层错误才走 McpError。
 * 绝不把任何授权材料写进日志或返回值。
 */

export interface StudioServerDeps {
  readonly service: StudioService;
  readonly version: string;
  /** 构建产物面板路径（dist/ui/panel.html）；null = 资源不可用（fail-closed）。 */
  readonly panelPath: string | null;
}

export function createStudioServer(deps: StudioServerDeps): Server {
  const server = new Server(
    { name: "mos-studio", version: deps.version },
    { capabilities: { resources: {}, tools: {} } },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: deps.panelPath
      ? [
          {
            uri: STUDIO_PANEL_URI,
            name: "MOS",
            mimeType: STUDIO_PANEL_MIME,
          },
        ]
      : [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== STUDIO_PANEL_URI || !deps.panelPath) {
      return { contents: [] };
    }
    const text = await readFile(deps.panelPath, "utf8");
    return {
      contents: [{ uri, mimeType: STUDIO_PANEL_MIME, text }],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: STUDIO_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      ...(tool.meta ? { _meta: tool.meta } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const context = studioSessionContextFromMeta(
      sessionFactsFromToolCallMeta(request.params._meta),
    );
    try {
      const tool = STUDIO_TOOLS.find((candidate) => candidate.name === name);
      if (!tool) {
        return errorResult(`Unknown tool: ${name}`);
      }
      const parsed = tool.parse(args);
      if (name === MOS_STUDIO_STATUS_TOOL) {
        return okResult(await deps.service.status(context));
      }
      if (name === MOS_SET_OPERATOR_TOOL) {
        const input = parsed as { user_id: string; organization_id?: string | null };
        return okResult(
          await deps.service.setOperator({
            userId: input.user_id,
            organizationId: input.organization_id ?? null,
          }),
        );
      }
      if (name === MOS_LIST_MISSIONS_TOOL) {
        const input = parsed as { source_zcode_session_id?: string | null };
        return okResult(
          await deps.service.listMissions(context, {
            source_zcode_session_id: input.source_zcode_session_id,
          }),
        );
      }
      if (name === MOS_RECORD_MISSION_INTAKE_TOOL) {
        const input = parsed as {
          objective_verbatim: string;
          target_audience?: string | null;
          geography?: string | null;
          desired_outcomes?: string[];
          success_metrics?: string[];
          deadline?: string | null;
        };
        return okResult(
          await deps.service.recordMissionIntake(context, {
            objective_verbatim: input.objective_verbatim,
            target_audience: input.target_audience ?? null,
            geography: input.geography ?? null,
            desired_outcomes: input.desired_outcomes ?? [],
            success_metrics: input.success_metrics ?? [],
            budget: null,
            deadline: input.deadline ?? null,
          }),
        );
      }
      if (name === MOS_CONNECT_COMPOSIO_TOOL) {
        const input = parsed as { api_key: string };
        return okResult(await deps.service.connectComposio(context, { apiKey: input.api_key }));
      }
      if (name === MOS_CAPABILITIES_TOOL) {
        return okResult(await deps.service.capabilities(context));
      }
      if (name === MOS_ROUTES_TOOL) {
        const input = parsed as { mission_id?: string };
        return okResult(await deps.service.routes(context, input.mission_id));
      }
      if (name === MOS_EXECUTE_AUTHORIZED_READ_TOOL) {
        const input = parsed as { query: string; limit?: number };
        return okResult(
          await deps.service.executeAuthorizedRead(context, {
            query: input.query,
            limit: input.limit,
          }),
        );
      }
      if (name === MOS_LIST_EVIDENCE_TOOL) {
        const input = parsed as { mission_id?: string };
        return okResult(await deps.service.listEvidence(context, input.mission_id));
      }
      if (name === MOS_RECORD_RESEARCH_NOTE_TOOL) {
        const input = parsed as {
          topic: string;
          findings?: { evidence_ref: string; statement: string }[];
          insight?: string | null;
          confidence?: number | null;
          limitations?: string[];
          mission_id?: string | null;
        };
        return okResult(
          await deps.service.recordResearchNote(context, {
            topic: input.topic,
            findings: input.findings ?? [],
            insight: input.insight ?? null,
            confidence: input.confidence ?? null,
            limitations: input.limitations ?? [],
            mission_id: input.mission_id,
          }),
        );
      }
      if (name === MOS_LIST_RESEARCH_NOTES_TOOL) {
        const input = parsed as { mission_id?: string };
        return okResult(await deps.service.listResearchNotes(context, input.mission_id));
      }
      if (name === MOS_PROPOSE_HYPOTHESIS_TOOL) {
        const input = parsed as {
          statement: string;
          rationale?: string | null;
          evidence_refs?: string[];
          proposed_route_ids?: string[];
          mission_id?: string;
        };
        return okResult(
          await deps.service.proposeHypothesis(context, {
            statement: input.statement,
            rationale: input.rationale ?? null,
            evidence_refs: input.evidence_refs ?? [],
            proposed_route_ids: input.proposed_route_ids ?? [],
            mission_id: input.mission_id,
          }),
        );
      }
      if (name === MOS_LIST_HYPOTHESES_TOOL) {
        const input = parsed as { mission_id?: string };
        return okResult(await deps.service.listHypotheses(context, input.mission_id));
      }
      if (name === MOS_COMPOSE_DRAFT_BRIEF_TOOL) {
        const input = parsed as {
          mission_id?: string;
          title: string;
          summary: string;
          operator_notes?: string | null;
          evidence_refs?: string[];
          research_note_ids?: string[];
          hypothesis_ids?: string[];
        };
        return okResult(
          await deps.service.composeDraftBrief(context, {
            mission_id: input.mission_id,
            title: input.title,
            summary: input.summary,
            operator_notes: input.operator_notes ?? null,
            evidence_refs: input.evidence_refs ?? [],
            research_note_ids: input.research_note_ids ?? [],
            hypothesis_ids: input.hypothesis_ids ?? [],
          }),
        );
      }
      if (name === MOS_LIST_DRAFT_BRIEFS_TOOL) {
        const input = parsed as { mission_id?: string };
        return okResult(await deps.service.listDraftBriefs(context, input.mission_id));
      }
      if (name === MOS_REVIEW_DRAFT_BRIEF_TOOL) {
        const input = parsed as { brief_id: string; decision: "approved" | "rejected"; note?: string | null };
        return okResult(
          await deps.service.reviewDraftBrief(context, {
            brief_id: input.brief_id,
            decision: input.decision,
            note: input.note ?? null,
          }),
        );
      }
      return errorResult(`Unknown tool: ${name}`);
    } catch (error) {
      return errorResult(describeError(error));
    }
  });

  return server;
}

function okResult(value: unknown) {
  // MCP structuredContent 必须是对象；数组结果包一层 items。
  const structured = Array.isArray(value) ? { items: value } : (value as Record<string, unknown>);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

function describeError(error: unknown): string {
  if (
    error instanceof StudioDataDirUnavailableError ||
    error instanceof StudioTenantUnavailableError ||
    error instanceof StudioInvalidInputError ||
    error instanceof StudioConnectionNotFoundError ||
    error instanceof StudioMissionNotFoundError ||
    error instanceof StudioEvidenceNotFoundError ||
    error instanceof StudioNoteNotFoundError ||
    error instanceof StudioHypothesisNotFoundError ||
    error instanceof StudioBriefNotFoundError
  ) {
    return `${error.name}: ${error.message}`;
  }
  if (error && typeof error === "object" && "issues" in error) {
    return `InvalidInput: ${JSON.stringify((error as { issues: unknown }).issues)}`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
