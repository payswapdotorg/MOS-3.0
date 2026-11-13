import { describe, expect, test } from "vitest";
import { ContractValidationError } from "@mos/contracts";
import {
  SANDBOX_FILESYSTEM_SCOPES,
  SandboxPolicyValidationError,
  validateSandboxPolicy,
} from "../src/index.js";

/**
 * 沙箱策略描述符（DESCRIPTOR ONLY，决策锁 #9）：fail-closed 校验矩阵——
 * 未知 scope / 缺字段 / 形状不符一律拒绝；本包不含任何调用路径（仅描述符）。
 */

describe("validateSandboxPolicy (fail-closed descriptor validation)", () => {
  test("accepts a minimal policy (workspace scope, no egress, no timeout)", () => {
    const policy = validateSandboxPolicy({
      network_egress: false,
      filesystem_scope: "workspace",
      timeout_ms: null,
    });
    expect(policy).toEqual({
      network_egress: false,
      filesystem_scope: "workspace",
      timeout_ms: null,
    });
  });

  test("accepts all closed-vocabulary scopes (workspace / none / unknown)", () => {
    for (const scope of SANDBOX_FILESYSTEM_SCOPES) {
      const policy = validateSandboxPolicy({
        network_egress: true,
        filesystem_scope: scope,
        timeout_ms: 1000,
      });
      expect(policy.filesystem_scope).toBe(scope);
    }
  });

  test("accepts a positive integer timeout", () => {
    const policy = validateSandboxPolicy({
      network_egress: false,
      filesystem_scope: "none",
      timeout_ms: 30000,
    });
    expect(policy.timeout_ms).toBe(30000);
  });

  test("unknown filesystem_scope value rejects (fail-closed)", () => {
    expect(() =>
      validateSandboxPolicy({
        network_egress: false,
        filesystem_scope: "host_root",
        timeout_ms: null,
      }),
    ).toThrow(SandboxPolicyValidationError);
    expect(() =>
      validateSandboxPolicy({
        network_egress: false,
        filesystem_scope: "EVERYTHING",
        timeout_ms: null,
      }),
    ).toThrow(SandboxPolicyValidationError);
  });

  test("missing fields reject (no defaults, never guessed)", () => {
    expect(() => validateSandboxPolicy({})).toThrow(SandboxPolicyValidationError);
    expect(() =>
      validateSandboxPolicy({ network_egress: false, filesystem_scope: "workspace" }),
    ).toThrow(SandboxPolicyValidationError);
    expect(() =>
      validateSandboxPolicy({ network_egress: false, timeout_ms: null }),
    ).toThrow(SandboxPolicyValidationError);
    expect(() =>
      validateSandboxPolicy({ filesystem_scope: "workspace", timeout_ms: null }),
    ).toThrow(SandboxPolicyValidationError);
  });

  test("non-boolean network_egress rejects", () => {
    expect(() =>
      validateSandboxPolicy({
        network_egress: "false",
        filesystem_scope: "workspace",
        timeout_ms: null,
      }),
    ).toThrow(SandboxPolicyValidationError);
    expect(() =>
      validateSandboxPolicy({
        network_egress: 0,
        filesystem_scope: "workspace",
        timeout_ms: null,
      }),
    ).toThrow(SandboxPolicyValidationError);
  });

  test("invalid timeout values reject (zero / negative / non-integer / non-number)", () => {
    for (const timeout_ms of [0, -1, 1.5, "1000", true]) {
      expect(() =>
        validateSandboxPolicy({
          network_egress: false,
          filesystem_scope: "workspace",
          timeout_ms,
        }),
      ).toThrow(SandboxPolicyValidationError);
    }
  });

  test("non-object input rejects (fail-closed on garbage)", () => {
    expect(() => validateSandboxPolicy(null)).toThrow(SandboxPolicyValidationError);
    expect(() => validateSandboxPolicy("workspace")).toThrow(SandboxPolicyValidationError);
    expect(() => validateSandboxPolicy(undefined)).toThrow(SandboxPolicyValidationError);
  });

  test("error is a typed ContractValidationError projection carrying named issues", () => {
    try {
      validateSandboxPolicy({ network_egress: false, filesystem_scope: "root", timeout_ms: null });
      expect.unreachable("validateSandboxPolicy must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxPolicyValidationError);
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as SandboxPolicyValidationError).issues.length).toBeGreaterThan(0);
      expect((error as SandboxPolicyValidationError).issues.join("\n")).toContain(
        "filesystem_scope",
      );
    }
  });

  test("unknown keys are stripped: the returned descriptor is canonical", () => {
    const policy = validateSandboxPolicy({
      network_egress: false,
      filesystem_scope: "none",
      timeout_ms: null,
      gpu_access: true,
    });
    expect(Object.keys(policy).sort()).toEqual(["filesystem_scope", "network_egress", "timeout_ms"]);
  });
});
