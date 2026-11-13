import {
  agentBodySchema,
  organizationSchema,
  parseOrFail,
} from "@mos/contracts";
import type { AgentBody, Organization } from "@mos/contracts";
import { agentBodyRegistrationSchema, AGENT_BODY_STATUS_ACTIVE } from "../contract/agent-body.js";
import type { AgentBodyRegistration } from "../contract/agent-body.js";
import {
  organizationRegistrationSchema,
  ORGANIZATION_STATUS_ACTIVE,
} from "../contract/organization.js";
import type { OrganizationRegistration } from "../contract/organization.js";
import {
  nodeOfferDraftInputSchema,
  nodeOfferRecordSchema,
  NODE_OFFER_STATUS_DRAFT,
} from "../contract/node-offer.js";
import type { NodeOfferDraftInput, NodeOfferRecord } from "../contract/node-offer.js";
import type { RegistrationDeps } from "../contract.js";

/**
 * 逐字 intake → AgentBody / Organization / NodeOffer 草稿（纯函数、零 I/O、零 Date/random）。
 *
 * 规则（invariant §9 同源纪律：缺失值绝不猜测）：
 * - 未提供的可空字段保持 null；数组逐字复制（空数组 = 显式"无"）；
 * - id / created_at / updated_at 由注入 deps 提供；
 * - AgentBody / Organization 注册恒为 active；offer 创建恒为 draft
 *   （发布只能走 NodeOfferStore.publish 门禁，不经 intake）；
 * - 产物双向守卫：先过命令 schema，再过持久记录 schema。
 */

/** 可能可空的字符串数组逐字复制（绝不别名调用方输入）。 */
function copyStringArray(value: readonly string[] | null): string[] | null {
  return value === null ? null : [...value];
}

/** AgentBody 注册命令 → AgentBody（status=active）。 */
export function agentBodyFromRegistration(
  command: AgentBodyRegistration,
  deps: RegistrationDeps,
): AgentBody {
  const normalized = parseOrFail(
    "AgentBodyRegistration",
    agentBodyRegistrationSchema,
    command,
  ) as AgentBodyRegistration;

  const body: AgentBody = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    kind: normalized.kind,
    display_name: normalized.display_name,
    organization_id: normalized.organization_id,
    role: normalized.role,
    evidenced_capability_ids: [...normalized.evidenced_capability_ids],
    status: AGENT_BODY_STATUS_ACTIVE,
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail("AgentBody", agentBodySchema, body) as AgentBody;
}

/** Organization 注册命令 → Organization（status=active）。 */
export function organizationFromRegistration(
  command: OrganizationRegistration,
  deps: RegistrationDeps,
): Organization {
  const normalized = parseOrFail(
    "OrganizationRegistration",
    organizationRegistrationSchema,
    command,
  ) as OrganizationRegistration;

  const organization: Organization = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    name: normalized.name,
    description: normalized.description,
    status: ORGANIZATION_STATUS_ACTIVE,
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail("Organization", organizationSchema, organization) as Organization;
}

/** NodeOffer 草稿输入 → 持久 offer 记录（status=draft；§8 未披露字段保持 null）。 */
export function nodeOfferFromDraftInput(
  input: NodeOfferDraftInput,
  deps: RegistrationDeps,
): NodeOfferRecord {
  const normalized = parseOrFail(
    "NodeOfferDraftInput",
    nodeOfferDraftInputSchema,
    input,
  ) as NodeOfferDraftInput;

  const record: NodeOfferRecord = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    node_ref: { kind: normalized.node_ref.kind, id: normalized.node_ref.id },
    capability_id: normalized.capability_id,
    inputs: copyStringArray(normalized.inputs),
    deliverables: copyStringArray(normalized.deliverables),
    availability:
      normalized.availability === null
        ? null
        : {
            windows: normalized.availability.windows,
            capacity: normalized.availability.capacity,
          },
    geography: normalized.geography,
    language: normalized.language,
    price_reward:
      normalized.price_reward === null
        ? null
        : {
            amount: normalized.price_reward.amount,
            currency: normalized.price_reward.currency,
          },
    deadline: normalized.deadline,
    sla: normalized.sla,
    rights_constraints: copyStringArray(normalized.rights_constraints),
    acceptance_evaluator:
      normalized.acceptance_evaluator === null
        ? null
        : {
            evaluator_ref: normalized.acceptance_evaluator.evaluator_ref,
            method: normalized.acceptance_evaluator.method,
          },
    evidence_refs: copyStringArray(normalized.evidence_refs),
    delivery_history: copyStringArray(normalized.delivery_history),
    status: NODE_OFFER_STATUS_DRAFT,
    created_at: deps.now,
    updated_at: deps.now,
  };

  return parseOrFail("NodeOfferRecord", nodeOfferRecordSchema, record) as NodeOfferRecord;
}
