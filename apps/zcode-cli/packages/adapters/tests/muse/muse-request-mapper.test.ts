/**
 * 请求映射与 CLI 探测解析的契约测试（ACR-0002）。
 * 版本输出取自本机实测 `muse --version`（Muse Code 1.4.20）。
 */

import { describe, expect, it } from "vitest";
import {
  MUSE_REASONING_EFFORTS,
  renderMuseTurnPrompt,
  toMuseReasoningEffort,
} from "../../src/model/muse/muse-request-mapper.js";
import {
  parseMuseUsageJson,
  parseMuseVersionOutput,
} from "../../src/model/muse/muse-detection.js";
import type { ModelExecutionRequest } from "../../src/model/model.js";

function request(messages: ModelExecutionRequest["messages"]): ModelExecutionRequest {
  return {
    messages,
    options: { reasoningLevel: "high", maxOutputTokens: 512 },
  };
}

describe("renderMuseTurnPrompt", () => {
  it("passes a single user message through verbatim (New Task 首轮语义)", () => {
    const prompt = renderMuseTurnPrompt(
      request([
        { role: "system", content: "You are ZCode..." },
        { role: "user", content: "Run the agent test suite and summarize failures" },
      ]),
    );
    expect(prompt).toBe("Run the agent test suite and summarize failures");
  });

  it("renders prior turns as transcript and marks the current request", () => {
    const prompt = renderMuseTurnPrompt(
      request([
        { role: "system", content: "sys" },
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "follow up" },
      ]),
    );
    expect(prompt).toContain("[Earlier conversation in this MOS task]");
    expect(prompt).toContain("User: first question");
    expect(prompt).toContain("Assistant: first answer");
    expect(prompt).toContain("[Current request]\nfollow up");
  });

  it("renders tool-result history compactly and never leaks the ZCode system prompt", () => {
    const prompt = renderMuseTurnPrompt(
      request([
        { role: "system", content: "SECRET-SYSTEM-PROMPT" },
        { role: "user", content: "list files" },
        {
          role: "tool",
          toolName: "bash",
          toolCallId: "t1",
          content: "file-a\nfile-b",
        },
        { role: "assistant", content: "two files" },
        { role: "user", content: "delete file-a" },
      ]),
    );
    expect(prompt).not.toContain("SECRET-SYSTEM-PROMPT");
    expect(prompt).toContain("[Tool result (bash)]: file-a");
    expect(prompt).toContain("[Current request]\ndelete file-a");
  });

  it("keeps only the tail when history exceeds the budget", () => {
    const long = "y".repeat(30_000);
    const prompt = renderMuseTurnPrompt(
      request([
        { role: "user", content: long },
        { role: "assistant", content: long },
        { role: "user", content: long },
        { role: "assistant", content: long },
        { role: "user", content: "final" },
      ]),
    );
    expect(prompt).toContain("(earlier conversation truncated)");
    expect(prompt).toContain("[Current request]\nfinal");
    expect(prompt.length).toBeLessThan(70_000 + 200);
  });

  it("rejects requests without a user message", () => {
    expect(() => renderMuseTurnPrompt(request([{ role: "system", content: "sys" }]))).toThrow(
      /requires a user message/i,
    );
  });
});

describe("toMuseReasoningEffort", () => {
  it("passes the closed CLI vocabulary through", () => {
    expect([...MUSE_REASONING_EFFORTS]).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    for (const tier of MUSE_REASONING_EFFORTS) {
      expect(toMuseReasoningEffort(tier)).toBe(tier);
    }
  });

  it("falls back to high (Muse Code 自身默认档位) on unknown values", () => {
    expect(toMuseReasoningEffort("disabled")).toBe("high");
    expect(toMuseReasoningEffort(undefined)).toBe("high");
  });
});

describe("parseMuseVersionOutput", () => {
  it("parses the real CLI version line", () => {
    expect(parseMuseVersionOutput("Muse Code 1.4.20 (1.4.20-R8619.1)\n")).toBe("1.4.20");
  });

  it("returns undefined for non-version output", () => {
    expect(parseMuseVersionOutput("muse: command not found")).toBeUndefined();
  });
});

describe("parseMuseUsageJson", () => {
  it("parses a usage object tolerantly", () => {
    expect(parseMuseUsageJson('{"plan":"power","percent_used":42}')).toEqual({
      plan: "power",
      percent_used: 42,
    });
  });

  it("rejects non-objects and empty output", () => {
    expect(parseMuseUsageJson("[]")).toBeUndefined();
    expect(parseMuseUsageJson("")).toBeUndefined();
    expect(parseMuseUsageJson("muse usage: not logged in")).toBeUndefined();
  });
});
