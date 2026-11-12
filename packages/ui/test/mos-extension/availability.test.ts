import { describe, expect, test } from "vitest";
import {
  resolveMosAvailability,
  unregisteredMosAvailability,
} from "@/mos-extension/domain/availability.js";
import type { MosHostServiceState } from "@/mos-extension/contract.js";

describe("resolveMosAvailability", () => {
  test("宿主未知（null）→ 不可用，reason host_stopped", () => {
    expect(
      resolveMosAvailability({ serviceState: null, mosEnabled: true, missionLinked: true }),
    ).toEqual({ available: false, reason: "host_stopped" });
  });

  test.each([["starting"], ["stopped"], ["restarting"]] as const)(
    "宿主中间态/停止 %s → 不可用，reason host_stopped",
    (serviceState: MosHostServiceState) => {
      expect(
        resolveMosAvailability({ serviceState, mosEnabled: true, missionLinked: true }),
      ).toEqual({ available: false, reason: "host_stopped" });
    },
  );

  test.each([["starting"], ["stopped"], ["restarting"]] as const)(
    "宿主 %s 且开关关闭/未关联 → 宿主门槛优先（host_stopped）",
    (serviceState: MosHostServiceState) => {
      expect(
        resolveMosAvailability({ serviceState, mosEnabled: false, missionLinked: false }),
      ).toEqual({ available: false, reason: "host_stopped" });
    },
  );

  test("宿主运行但开关关闭 → 不可用，reason disabled", () => {
    expect(
      resolveMosAvailability({ serviceState: "running", mosEnabled: false, missionLinked: true }),
    ).toEqual({ available: false, reason: "disabled" });
  });

  test("宿主运行、开关已开但 mission 未关联 → available=false，reason no_mission", () => {
    expect(
      resolveMosAvailability({ serviceState: "running", mosEnabled: true, missionLinked: false }),
    ).toEqual({ available: false, reason: "no_mission" });
  });

  test("running + 开关已开 + 已关联 → 唯一放行组合，reason null", () => {
    expect(
      resolveMosAvailability({ serviceState: "running", mosEnabled: true, missionLinked: true }),
    ).toEqual({ available: true, reason: null });
  });

  test("未知组合不猜值：开关关闭同时未关联 → disabled（开关门槛先于 mission）", () => {
    expect(
      resolveMosAvailability({ serviceState: "running", mosEnabled: false, missionLinked: false }),
    ).toEqual({ available: false, reason: "disabled" });
  });
});

describe("unregisteredMosAvailability", () => {
  test("未注册常量：fail-closed 且冻结", () => {
    expect(unregisteredMosAvailability).toEqual({ available: false, reason: "unregistered" });
    expect(Object.isFrozen(unregisteredMosAvailability)).toBe(true);
  });

  test("冻结对象在 ESM 严格模式下不可篡改", () => {
    expect(() => {
      (unregisteredMosAvailability as { available: boolean }).available = true;
    }).toThrow(TypeError);
  });
});
