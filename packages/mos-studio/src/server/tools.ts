import { z } from "zod";
import {
  APP_ONLY_VISIBILITY,
  BRIEF_OPERATOR_NOTES_MAX_LENGTH,
  BRIEF_SUMMARY_MAX_LENGTH,
  BRIEF_TITLE_MAX_LENGTH,
  HYPOTHESIS_RATIONALE_MAX_LENGTH,
  HYPOTHESIS_STATEMENT_MAX_LENGTH,
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
  NOTE_FINDING_STATEMENT_MAX_LENGTH,
  NOTE_INSIGHT_MAX_LENGTH,
  NOTE_TOPIC_MAX_LENGTH,
  READ_LIMIT_MAX,
  READ_QUERY_MAX_LENGTH,
  REVIEW_NOTE_MAX_LENGTH,
} from "../contract/studio-vocabulary.js";

/**
 * 工具定义（MCP tools/list 输入形状 + zod 校验 schema）。
 * 只读工具给模型与页面共用；写/授权工具 app-only（模型的工具列表不出现，页面照常可调）。
 */

export interface StudioToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: Record<string, unknown>;
  readonly meta: Record<string, unknown> | null;
  readonly parse: (args: unknown) => unknown;
}

const setOperatorArgs = z.strictObject({
  user_id: z.string().min(1).max(200),
  organization_id: z.string().min(1).max(200).nullable().optional(),
});

const recordIntakeArgs = z.strictObject({
  objective_verbatim: z.string().min(1).max(4000),
  target_audience: z.string().min(1).max(500).nullable().optional(),
  geography: z.string().min(1).max(200).nullable().optional(),
  desired_outcomes: z.array(z.string().min(1).max(500)).max(20).optional(),
  success_metrics: z.array(z.string().min(1).max(500)).max(20).optional(),
  deadline: z.string().min(1).max(64).nullable().optional(),
});

const connectComposioArgs = z.strictObject({
  api_key: z.string().min(1).max(4096),
});

const listMissionsArgs = z.strictObject({
  source_zcode_session_id: z.string().min(1).max(256).nullable().optional(),
});

const routesArgs = z.strictObject({
  mission_id: z.string().min(1).max(256).optional(),
});

const executeReadArgs = z.strictObject({
  query: z.string().min(1).max(READ_QUERY_MAX_LENGTH),
  limit: z.number().int().min(1).max(READ_LIMIT_MAX).optional(),
});

const missionFilterArgs = z.strictObject({
  mission_id: z.string().min(1).max(256).optional(),
});

const recordResearchNoteArgs = z.strictObject({
  topic: z.string().min(1).max(NOTE_TOPIC_MAX_LENGTH),
  findings: z
    .array(
      z.strictObject({
        evidence_ref: z.string().min(1).max(256),
        statement: z.string().min(1).max(NOTE_FINDING_STATEMENT_MAX_LENGTH),
      }),
    )
    .max(20)
    .optional(),
  insight: z.string().min(1).max(NOTE_INSIGHT_MAX_LENGTH).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  limitations: z.array(z.string().min(1).max(500)).max(20).optional(),
  mission_id: z.string().min(1).max(256).nullable().optional(),
});

const proposeHypothesisArgs = z.strictObject({
  statement: z.string().min(1).max(HYPOTHESIS_STATEMENT_MAX_LENGTH),
  rationale: z.string().min(1).max(HYPOTHESIS_RATIONALE_MAX_LENGTH).nullable().optional(),
  evidence_refs: z.array(z.string().min(1).max(256)).max(20).optional(),
  proposed_route_ids: z.array(z.string().min(1).max(256)).max(20).optional(),
  mission_id: z.string().min(1).max(256).optional(),
});

const composeDraftBriefArgs = z.strictObject({
  mission_id: z.string().min(1).max(256).optional(),
  title: z.string().min(1).max(BRIEF_TITLE_MAX_LENGTH),
  summary: z.string().min(1).max(BRIEF_SUMMARY_MAX_LENGTH),
  operator_notes: z.string().min(1).max(BRIEF_OPERATOR_NOTES_MAX_LENGTH).nullable().optional(),
  evidence_refs: z.array(z.string().min(1).max(256)).max(20).optional(),
  research_note_ids: z.array(z.string().min(1).max(256)).max(20).optional(),
  hypothesis_ids: z.array(z.string().min(1).max(256)).max(20).optional(),
});

const reviewDraftBriefArgs = z.strictObject({
  brief_id: z.string().min(1).max(256),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().min(1).max(REVIEW_NOTE_MAX_LENGTH).nullable().optional(),
});

const noArgs = z.strictObject({});

export const STUDIO_TOOLS: readonly StudioToolDefinition[] = [
  {
    name: MOS_STUDIO_STATUS_TOOL,
    title: "MOS studio status",
    description:
      "MOS studio composition-root status: operator declaration state, current session linkage, linked mission, connections and availability (fail-closed).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => noArgs.parse(args ?? {}),
  },
  {
    name: MOS_SET_OPERATOR_TOOL,
    title: "Declare MOS operator",
    description:
      "Declare the MOS operator identity (one-time, panel input). Stored only in the plugin data dir; never impersonates a ZCode account fact.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", minLength: 1, maxLength: 200 },
        organization_id: { type: ["string", "null"], maxLength: 200 },
      },
      required: ["user_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    meta: { ...APP_ONLY_VISIBILITY },
    parse: (args) => setOperatorArgs.parse(args ?? {}),
  },
  {
    name: MOS_LIST_MISSIONS_TOOL,
    title: "List MOS missions",
    description:
      "List tenant-scoped missions (optionally filtered by ZCode session id). Missions store only references to ZCode sessions; ZCode remains the sole authority of session/task state.",
    inputSchema: {
      type: "object",
      properties: {
        source_zcode_session_id: { type: ["string", "null"], maxLength: 256 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => listMissionsArgs.parse(args ?? {}),
  },
  {
    name: MOS_RECORD_MISSION_INTAKE_TOOL,
    title: "Record MOS mission intake (verbatim)",
    description:
      "Record a mission from verbatim human input (panel form). Zero inference: the objective is stored exactly as typed, with the current ZCode session reference when present.",
    inputSchema: {
      type: "object",
      properties: {
        objective_verbatim: { type: "string", minLength: 1, maxLength: 4000 },
        target_audience: { type: ["string", "null"], maxLength: 500 },
        geography: { type: ["string", "null"], maxLength: 200 },
        desired_outcomes: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
        success_metrics: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
        deadline: { type: ["string", "null"], maxLength: 64 },
      },
      required: ["objective_verbatim"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    meta: null,
    parse: (args) => recordIntakeArgs.parse(args ?? {}),
  },
  {
    name: MOS_CONNECT_COMPOSIO_TOOL,
    title: "Connect Composio account",
    description:
      "Connect the Composio provider for this tenant: stores the API key only in the real encrypted ZCode credential store (opaque ref in the connection record). Never echoes the key.",
    inputSchema: {
      type: "object",
      properties: { api_key: { type: "string", minLength: 1, maxLength: 4096 } },
      required: ["api_key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    meta: { ...APP_ONLY_VISIBILITY },
    parse: (args) => connectComposioArgs.parse(args ?? {}),
  },
  {
    name: MOS_CAPABILITIES_TOOL,
    title: "Resolve account capabilities",
    description:
      "Resolve capability instances for the connected accounts (fail-closed: available requires connected + scopes + verified tool mapping + implementation evidence).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => noArgs.parse(args ?? {}),
  },
  {
    name: MOS_ROUTES_TOOL,
    title: "Evaluate route candidates",
    description:
      "Evaluate route candidates (existing/conditional/blocked/unknown) for the mission linked to the current session (or a given mission id).",
    inputSchema: {
      type: "object",
      properties: { mission_id: { type: "string", maxLength: 256 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => routesArgs.parse(args ?? {}),
  },
  {
    name: MOS_EXECUTE_AUTHORIZED_READ_TOOL,
    title: "Execute one authorized read",
    description:
      "Execute one authorized read through the existing ZCode MCP client (Composio session MCP -> Hacker News search). Returns counts/shapes evidence only; never provider record content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: READ_QUERY_MAX_LENGTH },
        limit: { type: "integer", minimum: 1, maximum: READ_LIMIT_MAX },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    meta: { ...APP_ONLY_VISIBILITY },
    parse: (args) => executeReadArgs.parse(args ?? {}),
  },
  {
    name: MOS_LIST_EVIDENCE_TOOL,
    title: "List captured evidence",
    description:
      "List tenant-scoped evidence records captured by successful authorized reads (counts/shapes only, source-attributed: provider, tool, query, observed_at).",
    inputSchema: {
      type: "object",
      properties: { mission_id: { type: "string", maxLength: 256 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => missionFilterArgs.parse(args ?? {}),
  },
  {
    name: MOS_RECORD_RESEARCH_NOTE_TOOL,
    title: "Record research note (verbatim)",
    description:
      "Record a marketing research note from verbatim human input: topic, source-backed findings (each referencing captured evidence), insight, confidence, limitations. Facts must cite evidence; hypotheses belong to mos_propose_hypothesis.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", minLength: 1, maxLength: NOTE_TOPIC_MAX_LENGTH },
        findings: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              evidence_ref: { type: "string", minLength: 1, maxLength: 256 },
              statement: { type: "string", minLength: 1, maxLength: NOTE_FINDING_STATEMENT_MAX_LENGTH },
            },
            required: ["evidence_ref", "statement"],
            additionalProperties: false,
          },
        },
        insight: { type: ["string", "null"], maxLength: NOTE_INSIGHT_MAX_LENGTH },
        confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        limitations: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
        mission_id: { type: ["string", "null"], maxLength: 256 },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    meta: null,
    parse: (args) => recordResearchNoteArgs.parse(args ?? {}),
  },
  {
    name: MOS_LIST_RESEARCH_NOTES_TOOL,
    title: "List research notes",
    description:
      "List tenant-scoped research notes (facts with evidence references, insights, limitations; optionally filtered by mission).",
    inputSchema: {
      type: "object",
      properties: { mission_id: { type: "string", maxLength: 256 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => missionFilterArgs.parse(args ?? {}),
  },
  {
    name: MOS_PROPOSE_HYPOTHESIS_TOOL,
    title: "Propose hypothesis",
    description:
      "Propose a marketing hypothesis for a mission (statement, rationale, evidence references, proposed routes). Hypotheses never carry experiment outcomes (decision lock: results belong to the Experiment authority).",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string", minLength: 1, maxLength: HYPOTHESIS_STATEMENT_MAX_LENGTH },
        rationale: { type: ["string", "null"], maxLength: HYPOTHESIS_RATIONALE_MAX_LENGTH },
        evidence_refs: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
        proposed_route_ids: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
        mission_id: { type: "string", maxLength: 256 },
      },
      required: ["statement"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    meta: null,
    parse: (args) => proposeHypothesisArgs.parse(args ?? {}),
  },
  {
    name: MOS_LIST_HYPOTHESES_TOOL,
    title: "List hypotheses",
    description:
      "List tenant-scoped hypotheses (optionally filtered by mission). Facts and hypotheses are structurally distinguishable from research notes.",
    inputSchema: {
      type: "object",
      properties: { mission_id: { type: "string", maxLength: 256 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => missionFilterArgs.parse(args ?? {}),
  },
  {
    name: MOS_COMPOSE_DRAFT_BRIEF_TOOL,
    title: "Compose Studio draft brief",
    description:
      "Compose a draft production brief for a mission from selected evidence, research notes and hypotheses. Registers a versioned draft artifact with source lineage (provenance) and an honest unknown rights status; quality starts unreviewed.",
    inputSchema: {
      type: "object",
      properties: {
        mission_id: { type: "string", maxLength: 256 },
        title: { type: "string", minLength: 1, maxLength: BRIEF_TITLE_MAX_LENGTH },
        summary: { type: "string", minLength: 1, maxLength: BRIEF_SUMMARY_MAX_LENGTH },
        operator_notes: { type: ["string", "null"], maxLength: BRIEF_OPERATOR_NOTES_MAX_LENGTH },
        evidence_refs: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
        research_note_ids: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
        hypothesis_ids: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
      },
      required: ["title", "summary"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    meta: null,
    parse: (args) => composeDraftBriefArgs.parse(args ?? {}),
  },
  {
    name: MOS_LIST_DRAFT_BRIEFS_TOOL,
    title: "List draft briefs",
    description:
      "List tenant-scoped Studio draft briefs with artifact version, quality/rights status and the latest review decision (optionally filtered by mission).",
    inputSchema: {
      type: "object",
      properties: { mission_id: { type: "string", maxLength: 256 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    meta: null,
    parse: (args) => missionFilterArgs.parse(args ?? {}),
  },
  {
    name: MOS_REVIEW_DRAFT_BRIEF_TOOL,
    title: "Review draft brief (human decision)",
    description:
      "Record a human review decision (approved/rejected) for a draft brief: appends an append-only review_decision rights record and advances the artifact version chain. No external writes of any kind.",
    inputSchema: {
      type: "object",
      properties: {
        brief_id: { type: "string", minLength: 1, maxLength: 256 },
        decision: { type: "string", enum: ["approved", "rejected"] },
        note: { type: ["string", "null"], maxLength: REVIEW_NOTE_MAX_LENGTH },
      },
      required: ["brief_id", "decision"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    meta: { ...APP_ONLY_VISIBILITY },
    parse: (args) => reviewDraftBriefArgs.parse(args ?? {}),
  },
];
