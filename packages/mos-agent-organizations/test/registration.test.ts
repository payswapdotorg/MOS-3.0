import { describe, expect, test } from "vitest";
import {
  agentBodySchema,
  ContractValidationError,
  organizationSchema,
} from "@mos/contracts";
import {
  agentBodyFromRegistration,
  nodeOfferFromDraftInput,
  nodeOfferRecordSchema,
  organizationFromRegistration,
} from "../src/index.js";
import type {
  AgentBodyRegistration,
  NodeOfferDraftInput,
  OrganizationRegistration,
} from "../src/index.js";

/**
 * 逐字 intake 矩阵（domain/registration.ts，纯函数）：
 * 未提供的 §8/可空字段保持 null；数组逐字复制；status 由词表决定（active/draft）；
 * id / created_at / updated_at 全部来自注入 deps（领域层零 Date/random）。
 */

const NOW = "2026-11-13T00:00:00Z";

function baseBodyCommand(
  overrides: Partial<AgentBodyRegistration> = {},
): AgentBodyRegistration {
  return {
    tenant_id: "tenant-acme",
    kind: "human",
    display_name: "Ada L.",
    organization_id: null,
    role: null,
    evidenced_capability_ids: [],
    ...overrides,
  };
}

function baseOrgCommand(
  overrides: Partial<OrganizationRegistration> = {},
): OrganizationRegistration {
  return {
    tenant_id: "tenant-acme",
    name: "Acme Content Guild",
    description: null,
    ...overrides,
  };
}

function baseDraftInput(
  overrides: Partial<NodeOfferDraftInput> = {},
): NodeOfferDraftInput {
  return {
    tenant_id: "tenant-acme",
    node_ref: { kind: "human", id: "body-1" },
    capability_id: "cap-copywriting",
    inputs: null,
    deliverables: null,
    availability: null,
    geography: null,
    language: null,
    price_reward: null,
    deadline: null,
    sla: null,
    rights_constraints: null,
    acceptance_evaluator: null,
    evidence_refs: null,
    delivery_history: null,
    ...overrides,
  };
}

describe("agentBodyFromRegistration (verbatim, zero inference)", () => {
  test("unknown optional fields stay null; arrays verbatim; status active; deps injected", () => {
    const body = agentBodyFromRegistration(baseBodyCommand(), {
      id: "body-1",
      now: NOW,
    });
    expect(body).toEqual({
      id: "body-1",
      tenant_id: "tenant-acme",
      kind: "human",
      display_name: "Ada L.",
      organization_id: null,
      role: null,
      evidenced_capability_ids: [],
      status: "active",
      created_at: NOW,
      updated_at: NOW,
    });
  });

  test("provided optional fields pass through exactly", () => {
    const body = agentBodyFromRegistration(
      baseBodyCommand({
        kind: "agent",
        organization_id: "org-1",
        role: "copy lead",
        evidenced_capability_ids: ["cap-copywriting", "cap-editing"],
      }),
      { id: "body-2", now: NOW },
    );
    expect(body.kind).toBe("agent");
    expect(body.organization_id).toBe("org-1");
    expect(body.role).toBe("copy lead");
    expect(body.evidenced_capability_ids).toEqual(["cap-copywriting", "cap-editing"]);
  });

  test("output validates against the shared agentBodySchema", () => {
    const body = agentBodyFromRegistration(baseBodyCommand(), {
      id: "body-3",
      now: NOW,
    });
    expect(() => agentBodySchema.parse(body)).not.toThrow();
  });

  test("empty display_name is rejected (contract minimum)", () => {
    expect(() =>
      agentBodyFromRegistration(baseBodyCommand({ display_name: "" }), {
        id: "body-4",
        now: NOW,
      }),
    ).toThrow(ContractValidationError);
  });

  test("invalid actor kind is rejected (typed enum, fail-closed)", () => {
    expect(() =>
      agentBodyFromRegistration(
        baseBodyCommand({ kind: "spaceship" as AgentBodyRegistration["kind"] }),
        { id: "body-5", now: NOW },
      ),
    ).toThrow(ContractValidationError);
  });
});

describe("organizationFromRegistration (verbatim, zero inference)", () => {
  test("unknown description stays null; status active; deps injected", () => {
    const organization = organizationFromRegistration(baseOrgCommand(), {
      id: "org-1",
      now: NOW,
    });
    expect(organization).toEqual({
      id: "org-1",
      tenant_id: "tenant-acme",
      name: "Acme Content Guild",
      description: null,
      status: "active",
      created_at: NOW,
      updated_at: NOW,
    });
    expect(() => organizationSchema.parse(organization)).not.toThrow();
  });

  test("provided description passes through verbatim", () => {
    const organization = organizationFromRegistration(
      baseOrgCommand({ description: "B2B 营销内容团队" }),
      { id: "org-2", now: NOW },
    );
    expect(organization.description).toBe("B2B 营销内容团队");
  });

  test("empty name is rejected (contract minimum)", () => {
    expect(() =>
      organizationFromRegistration(baseOrgCommand({ name: "" }), {
        id: "org-3",
        now: NOW,
      }),
    ).toThrow(ContractValidationError);
  });
});

describe("nodeOfferFromDraftInput (verbatim, zero inference)", () => {
  test("all-unknown §8 fields stay null/verbatim; status stays draft; deps injected", () => {
    const record = nodeOfferFromDraftInput(baseDraftInput(), {
      id: "offer-1",
      now: NOW,
    });
    expect(record.status).toBe("draft");
    expect(record.id).toBe("offer-1");
    expect(record.created_at).toBe(NOW);
    expect(record.updated_at).toBe(NOW);
    expect(record.node_ref).toEqual({ kind: "human", id: "body-1" });
    expect(record.capability_id).toBe("cap-copywriting");
    expect(record.inputs).toBeNull();
    expect(record.deliverables).toBeNull();
    expect(record.availability).toBeNull();
    expect(record.geography).toBeNull();
    expect(record.language).toBeNull();
    expect(record.price_reward).toBeNull();
    expect(record.deadline).toBeNull();
    expect(record.sla).toBeNull();
    expect(record.rights_constraints).toBeNull();
    expect(record.acceptance_evaluator).toBeNull();
    expect(record.evidence_refs).toBeNull();
    expect(record.delivery_history).toBeNull();
  });

  test("provided §8 fields pass through exactly (null vs empty array preserved)", () => {
    const record = nodeOfferFromDraftInput(
      baseDraftInput({
        capability_id: null,
        inputs: [],
        deliverables: ["landing page copy"],
        availability: { windows: "Mon-Fri 09:00-17:00 UTC", capacity: null },
        geography: "global",
        language: "en",
        price_reward: { amount: "120.00", currency: "USD" },
        deadline: "2026-12-31T23:59:59Z",
        sla: "48h first draft",
        rights_constraints: [],
        acceptance_evaluator: { evaluator_ref: "eval-1", method: "human review panel" },
        evidence_refs: ["ev-1"],
        delivery_history: [],
      }),
      { id: "offer-2", now: NOW },
    );
    expect(record.capability_id).toBeNull();
    expect(record.inputs).toEqual([]);
    expect(record.deliverables).toEqual(["landing page copy"]);
    expect(record.availability).toEqual({
      windows: "Mon-Fri 09:00-17:00 UTC",
      capacity: null,
    });
    expect(record.geography).toBe("global");
    expect(record.language).toBe("en");
    expect(record.price_reward).toEqual({ amount: "120.00", currency: "USD" });
    expect(record.deadline).toBe("2026-12-31T23:59:59Z");
    expect(record.sla).toBe("48h first draft");
    expect(record.rights_constraints).toEqual([]);
    expect(record.acceptance_evaluator).toEqual({
      evaluator_ref: "eval-1",
      method: "human review panel",
    });
    expect(record.evidence_refs).toEqual(["ev-1"]);
    expect(record.delivery_history).toEqual([]);
  });

  test("output validates against nodeOfferRecordSchema (explicit-null draft is a legal record)", () => {
    const record = nodeOfferFromDraftInput(baseDraftInput(), {
      id: "offer-3",
      now: NOW,
    });
    expect(() => nodeOfferRecordSchema.parse(record)).not.toThrow();
  });

  test("non-RFC3339 deadline is rejected (fail-closed, never normalized)", () => {
    expect(() =>
      nodeOfferFromDraftInput(baseDraftInput({ deadline: "2026/12/31" }), {
        id: "offer-4",
        now: NOW,
      }),
    ).toThrow(ContractValidationError);
  });

  test("invalid currency code is rejected (ISO 4217 shape)", () => {
    expect(() =>
      nodeOfferFromDraftInput(
        baseDraftInput({ price_reward: { amount: "10.00", currency: "usd" } }),
        { id: "offer-5", now: NOW },
      ),
    ).toThrow(ContractValidationError);
  });
});
