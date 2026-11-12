import { describe, expect, test } from "vitest";
import { resolveMosStatusPresentation } from "@/mos-extension/domain/statusPresentation.js";
import type { MosMissionStatus, ResolvedAvailability } from "@/mos-extension/contract.js";

const AVAILABLE: ResolvedAvailability = { available: true, reason: null };
const NO_MISSION: ResolvedAvailability = { available: false, reason: "no_mission" };
const HOST_STOPPED: ResolvedAvailability = { available: false, reason: "host_stopped" };
const DISABLED: ResolvedAvailability = { available: false, reason: "disabled" };
const UNREGISTERED: ResolvedAvailability = { available: false, reason: "unregistered" };

const MISSION_STATUSES: readonly MosMissionStatus[] = ["unlinked", "linked", "error"];

describe("resolveMosStatusPresentation 语气映射", () => {
  test("available + linked → connected", () => {
    expect(
      resolveMosStatusPresentation({ availability: AVAILABLE, missionStatus: "linked" }),
    ).toEqual({ tone: "connected", label: "MOS: on" });
  });

  test("no_mission + unlinked → idle，标签 MOS: idle", () => {
    expect(
      resolveMosStatusPresentation({ availability: NO_MISSION, missionStatus: "unlinked" }),
    ).toEqual({ tone: "idle", label: "MOS: idle" });
  });

  test("error 保持可见：warning 语气", () => {
    expect(
      resolveMosStatusPresentation({ availability: NO_MISSION, missionStatus: "error" }),
    ).toEqual({ tone: "warning", label: "MOS: error" });
  });

  test.each(MISSION_STATUSES)("available + error → warning（%s 时同样 error 优先）", (status) => {
    expect(
      resolveMosStatusPresentation({ availability: AVAILABLE, missionStatus: status }),
    ).toEqual(
      status === "error"
        ? { tone: "warning", label: "MOS: error" }
        : status === "linked"
          ? { tone: "connected", label: "MOS: on" }
          : { tone: "idle", label: "MOS: idle" },
    );
  });
});

describe("resolveMosStatusPresentation 可见性（chip 是否渲染）", () => {
  test("availability 为 null → 不渲染", () => {
    expect(
      resolveMosStatusPresentation({ availability: null, missionStatus: "linked" }),
    ).toBeNull();
  });

  test.each([
    ["unregistered", UNREGISTERED],
    ["host_stopped", HOST_STOPPED],
    ["disabled", DISABLED],
  ] as const)("不可用原因 %s → 不渲染（对全部 mission 状态）", (_reason, availability) => {
    for (const missionStatus of MISSION_STATUSES) {
      expect(resolveMosStatusPresentation({ availability, missionStatus })).toBeNull();
    }
  });

  test("输入不一致时按最保守可显示态处理：available + unlinked → idle", () => {
    expect(
      resolveMosStatusPresentation({ availability: AVAILABLE, missionStatus: "unlinked" }),
    ).toEqual({ tone: "idle", label: "MOS: idle" });
  });

  test("输入不一致时按最保守可显示态处理：no_mission + linked → idle（不显示 connected）", () => {
    expect(
      resolveMosStatusPresentation({ availability: NO_MISSION, missionStatus: "linked" }),
    ).toEqual({ tone: "idle", label: "MOS: idle" });
  });

  test("可见区间 = available 或 reason=no_mission；no_mission 之外一律 null", () => {
    for (const missionStatus of MISSION_STATUSES) {
      expect(
        resolveMosStatusPresentation({ availability: AVAILABLE, missionStatus }),
      ).not.toBeNull();
      expect(
        resolveMosStatusPresentation({ availability: NO_MISSION, missionStatus }),
      ).not.toBeNull();
      expect(
        resolveMosStatusPresentation({ availability: HOST_STOPPED, missionStatus }),
      ).toBeNull();
    }
  });
});
