import type { Engine, Gig, NetworkNode, NodeOffer } from "@mos/contracts";
import { engineSchema } from "@mos/contracts";
import { gigFromInput, networkNodeFromInput } from "../src/index.js";
import type { GigIntake, NetworkNodeRegistrationInput } from "../src/index.js";

export const T1 = "2026-11-14T00:00:00Z";
export const T2 = "2026-11-14T01:00:00Z";
export const T3 = "2026-11-14T02:00:00Z";
export const LATER = "2026-11-30T12:00:00Z";
export const TENANT = "tenant-acme";
export const OTHER_TENANT = "tenant-globex";
export const CAPABILITY_ID = "media.caption.review";
export const STORE_FILE_NODES = "mos-network-nodes.json";
export const STORE_FILE_GIGS = "mos-gigs.json";

export const HUMAN_NODE_REF = { kind: "human", id: "agent-body-1" } as const;
export const AGENT_NODE_REF = { kind: "agent", id: "agent-body-2" } as const;

export function nodeRegistrationInput(
  overrides: Partial<NetworkNodeRegistrationInput> = {},
): NetworkNodeRegistrationInput {
  return {
    tenant_id: TENANT,
    node_ref: HUMAN_NODE_REF,
    display_name: "Caption review specialist",
    evidenced_capability_ids: [CAPABILITY_ID],
    availability: { windows: "weekdays 09-17 UTC", capacity: "4/day" },
    geography: "GH",
    language: "en",
    evidence_refs: ["ev-node-1"],
    ...overrides,
  };
}

export function registeredNode(
  overrides: Partial<NetworkNode> = {},
  inputOverrides: Partial<NetworkNodeRegistrationInput> = {},
): NetworkNode {
  const node = networkNodeFromInput(nodeRegistrationInput(inputOverrides), {
    id: "node-1",
    now: T1,
  });
  return { ...node, ...overrides };
}

export function publishedOffer(overrides: Partial<NodeOffer> = {}): NodeOffer {
  return {
    id: "offer-1",
    tenant_id: TENANT,
    node_ref: HUMAN_NODE_REF,
    capability_id: CAPABILITY_ID,
    inputs: ["caption sheet"],
    deliverables: ["reviewed sheet"],
    availability: { windows: "weekdays", capacity: "4/day" },
    geography: "GH",
    language: "en",
    price_reward: { amount: "25.00", currency: "USD" },
    deadline: LATER,
    sla: "48h turnaround",
    rights_constraints: [],
    acceptance_evaluator: { evaluator_ref: "eval-1", method: "per-item rubric" },
    evidence_refs: ["ev-offer-1"],
    delivery_history: ["dh-1"],
    status: "published",
    created_at: T1,
    updated_at: T1,
    ...overrides,
  } as NodeOffer;
}

export function registeredEngine(overrides: Partial<Engine> = {}): Engine {
  return engineSchema.parse({
    id: "engine-1",
    tenant_id: TENANT,
    version: 1,
    display_name: "Local caption engine",
    capability_ids: [CAPABILITY_ID],
    provider_id: null,
    sandbox_policy: { network_egress: false },
    benchmark_refs: [],
    license_terms: null,
    cost_model: null,
    status: "registered",
    created_at: T1,
    updated_at: T1,
    ...overrides,
  });
}

export function gigIntake(overrides: Partial<GigIntake> = {}): GigIntake {
  return {
    tenant_id: TENANT,
    mission_id: "mission-1",
    objective: "Review final captions for regional compliance",
    source_refs: ["art-caption-v3"],
    script_brief: "Check each caption against the regional brief",
    capture_or_execution_instructions: "Annotate issues in the shared sheet",
    expected_output: "Reviewed sheet with per-caption verdicts",
    consent_rights: ["rights-record-1"],
    evaluator: { evaluator_ref: "eval-1", method: "per-item rubric" },
    deadline: LATER,
    budget_reward: { amount: "25.00", currency: "USD" },
    expected_value_of_waiting: { amount: "5.00", currency: "USD" },
    alternative_route_ids: ["route-agent-1", "route-reuse-1"],
    ...overrides,
  };
}

export function draftGig(
  overrides: Partial<Gig> = {},
  intakeOverrides: Partial<GigIntake> = {},
): Gig {
  const gig = gigFromInput(gigIntake(intakeOverrides), { id: "gig-1", now: T1 });
  return { ...gig, ...overrides };
}

export function humanOption(overrides: Record<string, unknown> = {}) {
  return {
    kind: "human_offer",
    ref: "offer-human-1",
    estimated_cost: { amount: "25.00", currency: "USD" },
    estimated_latency_ms: 172_800_000,
    adequacy: "adequate",
    inadequacy_reason: null,
    ...overrides,
  };
}

export function machineOption(overrides: Record<string, unknown> = {}) {
  return {
    kind: "agent_offer",
    ref: "offer-agent-1",
    estimated_cost: { amount: "0.50", currency: "USD" },
    estimated_latency_ms: 5000,
    adequacy: "inadequate",
    inadequacy_reason: "no published agent offer covers regional compliance review",
    ...overrides,
  };
}

export function engineOption(overrides: Record<string, unknown> = {}) {
  return {
    kind: "engine",
    ref: "engine-1",
    estimated_cost: { amount: "0.10", currency: "USD" },
    estimated_latency_ms: 1000,
    adequacy: "unknown",
    inadequacy_reason: null,
    ...overrides,
  };
}

export function reuseOption(overrides: Record<string, unknown> = {}) {
  return {
    kind: "no_op_reuse",
    ref: "route-reuse-1",
    estimated_cost: { amount: "0.00", currency: "USD" },
    estimated_latency_ms: 0,
    adequacy: "unapproved",
    inadequacy_reason: "rights gate denied reuse of prior asset",
    ...overrides,
  };
}

export function justifiedComparison(overrides: Record<string, unknown> = {}) {
  return {
    compared_options: [
      machineOption(),
      engineOption(),
      reuseOption(),
      humanOption(),
    ],
    recommendation: "human",
    evidence_refs: ["ev-compare-1"],
    compared_at: T1,
    ...overrides,
  };
}
