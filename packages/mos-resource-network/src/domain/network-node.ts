import { assertTenantScope, parseOrFail } from "@mos/contracts";
import type { NetworkNode } from "@mos/contracts";
import { networkNodeRegistrationInputSchema } from "../contract/network-node.js";
import type { NetworkNodeRegistrationInput } from "../contract/network-node.js";
import { NETWORK_NODE_STATUS_ACTIVE } from "../contract/network-node.js";

/**
 * 纯物化器：登记输入 → NetworkNode（零 Date/random；id/now 注入）。
 * 登记恒为 active（§26：inactive/unknown 由发现层具名浮出，绝不静默过滤）。
 */
export function networkNodeFromInput(
  input: NetworkNodeRegistrationInput,
  deps: { id: string; now: string },
): NetworkNode {
  const normalized = parseOrFail(
    "NetworkNodeRegistrationInput",
    networkNodeRegistrationInputSchema,
    input,
  ) as NetworkNodeRegistrationInput;

  const node: NetworkNode = {
    id: deps.id,
    tenant_id: normalized.tenant_id,
    node_ref: { ...normalized.node_ref },
    display_name: normalized.display_name,
    evidenced_capability_ids: [...normalized.evidenced_capability_ids],
    availability: { ...normalized.availability },
    geography: normalized.geography,
    language: normalized.language,
    evidence_refs: [...normalized.evidence_refs],
    status: NETWORK_NODE_STATUS_ACTIVE,
    created_at: deps.now,
    updated_at: deps.now,
  };
  assertTenantScope(node, { tenant_id: normalized.tenant_id }, "network node");
  return node;
}
