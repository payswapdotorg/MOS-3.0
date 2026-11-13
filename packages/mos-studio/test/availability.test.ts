import { describe, expect, test } from "vitest";
import {
  resolveStudioAvailability,
  resolveStudioStatusPresentation,
} from "../src/domain/availability.js";

/**
 * 可用性语义矩阵 —— 镜像 packages/ui/src/mos-extension 的门序与原因词汇
 * （host → switch → mission；语义一致性是本镜像的机器保证）。
 */

describe("resolveStudioAvailability", () => {
  test("running + enabled + session + linked mission → available", () => {
    expect(
      resolveStudioAvailability({
        hostState: "running",
        mosEnabled: true,
        missionLinked: true,
        sessionContextAvailable: true,
      }),
    ).toEqual({ available: true, reason: null });
  });

  test.each(["starting", "stopped", "restarting"] as const)(
    "host %s → host_stopped (highest gate)",
    (hostState) => {
      expect(
        resolveStudioAvailability({
          hostState,
          mosEnabled: true,
          missionLinked: true,
          sessionContextAvailable: true,
        }),
      ).toEqual({ available: false, reason: "host_stopped" });
    },
  );

  test("disabled → disabled (even with linked mission)", () => {
    expect(
      resolveStudioAvailability({
        hostState: "running",
        mosEnabled: false,
        missionLinked: true,
        sessionContextAvailable: true,
      }),
    ).toEqual({ available: false, reason: "disabled" });
  });

  test("missing session context → session_context_unavailable (before mission gate)", () => {
    expect(
      resolveStudioAvailability({
        hostState: "running",
        mosEnabled: true,
        missionLinked: true,
        sessionContextAvailable: false,
      }),
    ).toEqual({ available: false, reason: "session_context_unavailable" });
  });

  test("no linked mission → no_mission", () => {
    expect(
      resolveStudioAvailability({
        hostState: "running",
        mosEnabled: true,
        missionLinked: false,
        sessionContextAvailable: true,
      }),
    ).toEqual({ available: false, reason: "no_mission" });
  });
});

describe("resolveStudioStatusPresentation", () => {
  test("available → connected chip", () => {
    expect(
      resolveStudioStatusPresentation({
        availability: { available: true, reason: null },
        missionStatus: "linked",
      }),
    ).toEqual({ tone: "connected", label: "MOS: on" });
  });

  test("no_mission → idle chip (visible)", () => {
    expect(
      resolveStudioStatusPresentation({
        availability: { available: false, reason: "no_mission" },
        missionStatus: "unlinked",
      }),
    ).toEqual({ tone: "idle", label: "MOS: idle" });
  });

  test("mission error always visible as warning (inconsistent availability degrades)", () => {
    expect(
      resolveStudioStatusPresentation({
        availability: { available: true, reason: null },
        missionStatus: "error",
      }),
    ).toEqual({ tone: "warning", label: "MOS: error" });
  });

  test("host_stopped → no chip (invisible)", () => {
    expect(
      resolveStudioStatusPresentation({
        availability: { available: false, reason: "host_stopped" },
        missionStatus: "linked",
      }),
    ).toBeNull();
  });

  test("null availability → no chip", () => {
    expect(
      resolveStudioStatusPresentation({ availability: null, missionStatus: "linked" }),
    ).toBeNull();
  });
});
