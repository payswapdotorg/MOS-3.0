/**
 * Muse 审批桥策略契约测试（ACR-0002）。
 * 语义来源：@muse-code/sdk approval.ts（select-never-create、default-deny）
 * 与 msp.d.ts（ApprovalChoice.decision/scope、protectedWrite、ApprovalSubject.kind）。
 */

import { describe, expect, it } from "vitest";
import {
  decideMuseApproval,
  resolveMuseToolApprovalPolicy,
} from "../../src/model/muse/muse-approval-policy.js";
import type { MuseApprovalRequestParams } from "../../src/model/muse/muse-event-mapper.js";

function approvalRequest(overrides: Partial<MuseApprovalRequestParams> = {}): MuseApprovalRequestParams {
  return {
    approvalId: "aprv_1",
    availableChoices: [
      { choiceId: "choice_allow_once", decision: "approved", label: "Allow once", scope: "once" },
      { choiceId: "choice_allow_session", decision: "approvedForSession", label: "Allow for session", scope: "session" },
      { choiceId: "choice_deny", decision: "denied", label: "Deny", scope: "once" },
    ],
    currentRequirementId: { approvalId: "aprv_1", sourceIndex: 0 },
    sessionId: "sess_1",
    subject: { kind: "shell", command: "cargo test" },
    toolCallId: "call_1",
    toolName: "bash",
    turnId: "turn_1",
    viewCursor: "v10:sess:1",
    ...overrides,
  } as unknown as MuseApprovalRequestParams;
}

describe("resolveMuseToolApprovalPolicy", () => {
  it("defaults to deny", () => {
    expect(resolveMuseToolApprovalPolicy(undefined)).toBe("deny");
    expect(resolveMuseToolApprovalPolicy("garbage")).toBe("deny");
  });

  it("accepts allow-once spellings only", () => {
    expect(resolveMuseToolApprovalPolicy("allow-once")).toBe("allow-once");
    expect(resolveMuseToolApprovalPolicy("allow_once")).toBe("allow-once");
    expect(resolveMuseToolApprovalPolicy("allowOnce")).toBe("allow-once");
  });
});

describe("decideMuseApproval (deny 默认)", () => {
  it("picks the offered denied choice", () => {
    const decision = decideMuseApproval(approvalRequest(), "deny");
    expect(decision).toEqual({ choiceId: "choice_deny" });
  });

  it("falls back to abort when no denied choice exists", () => {
    const request = approvalRequest({
      availableChoices: [
        { choiceId: "c_allow", decision: "approved", scope: "once" },
        { choiceId: "c_abort", decision: "abort", scope: "once" },
      ],
    });
    expect(decideMuseApproval(request, "deny")).toEqual({ choiceId: "c_abort" });
  });

  it("never approves under deny even when only approvals are offered", () => {
    const request = approvalRequest({
      availableChoices: [{ choiceId: "c_allow", decision: "approved", scope: "once" }],
    });
    // 没有任何拒绝选项：不猜（交由宿主默认拒绝兜底），不得选择批准。
    const decision = decideMuseApproval(request, "deny");
    expect(decision.choiceId).not.toBe("c_allow");
  });
});

describe("decideMuseApproval (allow-once 有界放行)", () => {
  it("picks approved with scope once", () => {
    expect(decideMuseApproval(approvalRequest(), "allow-once")).toEqual({
      choiceId: "choice_allow_once",
    });
  });

  it("refuses session-scoped approvals when no once choice is offered", () => {
    const request = approvalRequest({
      availableChoices: [
        { choiceId: "c_session", decision: "approvedForSession", scope: "session" },
        { choiceId: "c_deny", decision: "denied", scope: "once" },
      ],
    });
    expect(decideMuseApproval(request, "allow-once")).toEqual({ choiceId: "c_deny" });
  });

  it("always denies protected writes", () => {
    const request = approvalRequest({ protectedWrite: true });
    expect(decideMuseApproval(request, "allow-once")).toEqual({ choiceId: "choice_deny" });
  });

  it("denies unrecognized subject kinds even with once choices offered", () => {
    const request = approvalRequest({ subject: { kind: "somethingNew" } });
    expect(decideMuseApproval(request, "allow-once")).toEqual({ choiceId: "choice_deny" });
  });
});
