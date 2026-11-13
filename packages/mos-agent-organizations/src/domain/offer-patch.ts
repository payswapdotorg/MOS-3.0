import type { NodeOfferRecord, OfferPublishInput } from "../contract/node-offer.js";

/** 可能可空的字符串数组逐字复制（绝不别名调用方输入）。 */
function copyStringArray(value: readonly string[] | null): string[] | null {
  return value === null ? null : [...value];
}

/**
 * 发布补丁应用（纯函数）：出现的键逐字替换（显式 null = 置回未知、空数组 = 显式"无"），
 * 缺席的键保持草稿原值；任何字段都不做默认，输入永不被变异。
 * 补丁只覆盖 §8 披露字段；tenant/node_ref（要约身份）不在补丁范围内。
 */
export function applyOfferPublishPatch(
  record: NodeOfferRecord,
  patch: OfferPublishInput,
): NodeOfferRecord {
  return {
    ...record,
    capability_id: patch.capability_id !== undefined ? patch.capability_id : record.capability_id,
    inputs: patch.inputs !== undefined ? copyStringArray(patch.inputs) : record.inputs,
    deliverables:
      patch.deliverables !== undefined ? copyStringArray(patch.deliverables) : record.deliverables,
    availability:
      patch.availability !== undefined
        ? patch.availability === null
          ? null
          : {
              windows: patch.availability.windows,
              capacity: patch.availability.capacity,
            }
        : record.availability,
    geography: patch.geography !== undefined ? patch.geography : record.geography,
    language: patch.language !== undefined ? patch.language : record.language,
    price_reward:
      patch.price_reward !== undefined
        ? patch.price_reward === null
          ? null
          : {
              amount: patch.price_reward.amount,
              currency: patch.price_reward.currency,
            }
        : record.price_reward,
    deadline: patch.deadline !== undefined ? patch.deadline : record.deadline,
    sla: patch.sla !== undefined ? patch.sla : record.sla,
    rights_constraints:
      patch.rights_constraints !== undefined
        ? copyStringArray(patch.rights_constraints)
        : record.rights_constraints,
    acceptance_evaluator:
      patch.acceptance_evaluator !== undefined
        ? patch.acceptance_evaluator === null
          ? null
          : {
              evaluator_ref: patch.acceptance_evaluator.evaluator_ref,
              method: patch.acceptance_evaluator.method,
            }
        : record.acceptance_evaluator,
    evidence_refs:
      patch.evidence_refs !== undefined ? copyStringArray(patch.evidence_refs) : record.evidence_refs,
    delivery_history:
      patch.delivery_history !== undefined
        ? copyStringArray(patch.delivery_history)
        : record.delivery_history,
  };
}
