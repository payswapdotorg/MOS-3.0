import { describe, expect, test } from "vitest";
import {
  ContractValidationError,
  InvariantViolation,
  routeSchema,
} from "@mos/contracts";
import type { Route } from "@mos/contracts";
import {
  compareRoutes,
  evaluateRouteCandidates,
} from "../src/index.js";
import type { RouteInstanceFact } from "../src/index.js";
import {
  baseInstance,
  baseMission,
  fact,
  MISSION_ID,
  NOW,
  TENANT,
} from "./fixtures.js";

/**
 * 路由候选评估矩阵（fail-closed；week-1-integration.md Stage 2：
 * existing/conditional/blocked/unknown 可区分，绝不发明能力或前提）。
 */

function evaluate(
  facts: readonly RouteInstanceFact[],
  options: { idSeed?: number; mission?: ReturnType<typeof baseMission> } = {},
) {
  return evaluateRouteCandidates({
    mission: options.mission ?? baseMission(),
    capabilityInstances: facts,
    now: NOW,
    idSeed: options.idSeed ?? 1,
  });
}

describe("evaluateRouteCandidates (fail-closed classification)", () => {
  test("available + read side effect → existing, no approval binding, empty preconditions", () => {
    const { routes, summary } = evaluate([fact(baseInstance(), "read")]);
    expect(routes).toHaveLength(1);
    const [route] = routes;
    expect(route?.route_class).toBe("existing");
    expect(route?.status).toBe("candidate");
    expect(route?.preconditions).toEqual([]);
    expect(route?.approvals).toEqual([]);
    expect(route?.steps).toHaveLength(1);
    expect(route?.steps[0]?.capability_instance_id).toBe(baseInstance().id);
    expect(route?.steps[0]?.side_effect).toBe("read");
    expect(route?.mission_id).toBe(MISSION_ID);
    expect(route?.tenant_id).toBe(TENANT);
    expect(summary).toEqual({
      total: 1,
      existing: 1,
      conditional: 0,
      opportunity_constrained: 0,
      blocked: 0,
      unknown: 0,
    });
  });

  test("available + write side effect → existing with zcode_existing_permissions approval binding", () => {
    for (const sideEffect of ["create", "update", "publish", "delete"] as const) {
      const { routes } = evaluate([fact(baseInstance(), sideEffect)]);
      expect(routes[0]?.route_class).toBe("existing");
      expect(routes[0]?.approvals).toEqual(["zcode_existing_permissions"]);
    }
  });

  test("side effect none → no approval binding; unknown side effect fails closed to approval binding", () => {
    const none = evaluate([fact(baseInstance(), "none")]);
    expect(none.routes[0]?.route_class).toBe("existing");
    expect(none.routes[0]?.approvals).toEqual([]);

    const unknown = evaluate([fact(baseInstance(), "unknown")]);
    expect(unknown.routes[0]?.route_class).toBe("existing");
    expect(unknown.routes[0]?.approvals).toEqual(["zcode_existing_permissions"]);
  });

  test("unavailable + missing preconditions → conditional with exact strings (never invented, never dropped)", () => {
    const instance = baseInstance({
      status: "unavailable",
      missing_preconditions: [
        "scope:crm.objects.contacts.read",
        "account_type:unknown",
      ],
    });
    const { routes } = evaluate([fact(instance, "read")]);
    expect(routes[0]?.route_class).toBe("conditional");
    expect(routes[0]?.preconditions).toEqual([
      "scope:crm.objects.contacts.read",
      "account_type:unknown",
    ]);
    expect(routes[0]?.unknowns).toEqual([]);
    expect(routes[0]?.approvals).toEqual([]);
  });

  test("unavailable without disclosed preconditions → unknown (cannot explain, never pretend conditional)", () => {
    const instance = baseInstance({ status: "unavailable", missing_preconditions: [] });
    const { routes } = evaluate([fact(instance, "read")]);
    expect(routes[0]?.route_class).toBe("unknown");
    expect(routes[0]?.preconditions).toEqual([]);
    expect(routes[0]?.unknowns).toEqual([
      "instance_status:unavailable_no_preconditions_disclosed",
    ]);
  });

  test("support unknown → unknown route; instance preconditions copied to unknowns; floor marker when none disclosed", () => {
    const disclosed = baseInstance({
      support_status: "unknown",
      status: "unavailable",
      missing_preconditions: ["tool_mapping_unverified"],
    });
    const disclosedResult = evaluate([fact(disclosed, "read")]);
    expect(disclosedResult.routes[0]?.route_class).toBe("unknown");
    expect(disclosedResult.routes[0]?.unknowns).toEqual(["tool_mapping_unverified"]);

    const silent = baseInstance({
      support_status: "unknown",
      status: "unavailable",
      missing_preconditions: [],
    });
    const silentResult = evaluate([fact(silent, "read")]);
    expect(silentResult.routes[0]?.route_class).toBe("unknown");
    expect(silentResult.routes[0]?.unknowns).toEqual(["support_status:unknown"]);
  });

  test("instance status unknown (support supported) → unknown route", () => {
    const instance = baseInstance({
      status: "unknown",
      missing_preconditions: ["implementation:unknown"],
    });
    const { routes } = evaluate([fact(instance, "read")]);
    expect(routes[0]?.route_class).toBe("unknown");
    expect(routes[0]?.unknowns).toEqual(["implementation:unknown"]);
  });

  test("no capability instances at all → single unknown route, never blocked, never existing", () => {
    const { routes, summary } = evaluate([]);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.route_class).toBe("unknown");
    expect(routes[0]?.unknowns).toEqual(["no_capability_instances_resolved"]);
    expect(routes[0]?.steps).toEqual([]);
    expect(routes[0]?.preconditions).toEqual([]);
    expect(routes[0]?.approvals).toEqual([]);
    expect(summary.unknown).toBe(1);
    expect(summary.existing).toBe(0);
    expect(summary.blocked).toBe(0);
  });

  test("irreversible side effect without an approval path → blocked, even when the instance is available", () => {
    const { routes } = evaluate([fact(baseInstance(), "irreversible")]);
    expect(routes[0]?.route_class).toBe("blocked");
    expect(routes[0]?.risks).toEqual(["side_effect:irreversible"]);
    expect(routes[0]?.approvals).toEqual([]);
    expect(routes[0]?.preconditions).toEqual([]);
  });

  test("unsupported capability → blocked (terminal knowledge; never existing even if the account looks fine)", () => {
    const instance = baseInstance({ support_status: "unsupported", status: "available" });
    const { routes } = evaluate([fact(instance, "read")]);
    expect(routes[0]?.route_class).toBe("blocked");
    expect(routes[0]?.risks).toEqual(["support_status:unsupported"]);
  });

  test("degraded instance → conditional with copied preconditions and degradation risk disclosed", () => {
    const instance = baseInstance({
      status: "degraded",
      missing_preconditions: ["rate_limit:temporary"],
    });
    const { routes } = evaluate([fact(instance, "read")]);
    expect(routes[0]?.route_class).toBe("conditional");
    expect(routes[0]?.preconditions).toEqual(["rate_limit:temporary"]);
    expect(routes[0]?.risks).toEqual(["implementation:degraded"]);
  });

  test("cross-tenant instance fails closed with InvariantViolation", () => {
    const foreign = baseInstance({ tenant_id: "tenant-globex" });
    expect(() => evaluate([fact(foreign, "read")])).toThrow(InvariantViolation);
  });

  test("compareRoutes distinguishes every class; summary equals compareRoutes(routes)", () => {
    const { routes, summary } = evaluate([
      fact(baseInstance(), "read"), // existing
      fact(baseInstance({ id: "ci:2", status: "unavailable", missing_preconditions: ["scope:x"] }), "read"), // conditional
      fact(baseInstance({ id: "ci:3", support_status: "unknown", status: "unavailable", missing_preconditions: ["tool_mapping_unverified"] }), "read"), // unknown
      fact(baseInstance({ id: "ci:4" }), "irreversible"), // blocked
      fact(baseInstance({ id: "ci:5", support_status: "unsupported" }), "read"), // blocked
    ]);
    expect(summary).toEqual({
      total: 5,
      existing: 1,
      conditional: 1,
      opportunity_constrained: 0,
      blocked: 2,
      unknown: 1,
    });
    expect(summary).toEqual(compareRoutes(routes));
    expect(compareRoutes([])).toEqual({
      total: 0,
      existing: 0,
      conditional: 0,
      opportunity_constrained: 0,
      blocked: 0,
      unknown: 0,
    });
  });

  test("every route is schema-valid; no estimates are guessed; no silent fallback (fallback_route_ids always [])", () => {
    const outcomes = [
      evaluate([fact(baseInstance(), "read")]),
      evaluate([fact(baseInstance(), "create")]),
      evaluate([
        fact(
          baseInstance({ status: "unavailable", missing_preconditions: ["connection:expired"] }),
          "read",
        ),
      ]),
      evaluate([
        fact(
          baseInstance({ support_status: "unknown", status: "unavailable", missing_preconditions: [] }),
          "read",
        ),
      ]),
      evaluate([fact(baseInstance(), "irreversible")]),
      evaluate([]),
    ];
    for (const outcome of outcomes) {
      for (const route of outcome.routes) {
        expect(() => routeSchema.parse(route)).not.toThrow();
        expect(route.fallback_route_ids).toEqual([]);
        expect(route.estimated_cost).toBeNull();
        expect(route.estimated_latency_ms).toBeNull();
        expect(route.confidence).toBeNull();
      }
    }
  });

  test("ids are deterministic per (mission, seed); a different seed namespaces differently", () => {
    const first = evaluate([fact(baseInstance(), "read")], { idSeed: 1 });
    const again = evaluate([fact(baseInstance(), "read")], { idSeed: 1 });
    expect((again.routes[0] as Route).id).toBe((first.routes[0] as Route).id);
    expect(first.routes[0]?.id).toBe(`route:${MISSION_ID}:1:1`);

    const otherSeed = evaluate([fact(baseInstance(), "read")], { idSeed: 7 });
    expect(otherSeed.routes[0]?.id).toBe(`route:${MISSION_ID}:7:1`);

    const two = evaluate([fact(baseInstance(), "read"), fact(baseInstance({ id: "ci:2" }), "read")]);
    expect(two.routes.map((route) => route.id)).toEqual([
      `route:${MISSION_ID}:1:1`,
      `route:${MISSION_ID}:1:2`,
    ]);
  });

  test("invalid inputs fail closed with ContractValidationError", () => {
    expect(() =>
      evaluateRouteCandidates({
        mission: baseMission(),
        capabilityInstances: [fact(baseInstance(), "read")],
        now: "not-a-timestamp",
        idSeed: 1,
      }),
    ).toThrow(ContractValidationError);

    expect(() =>
      evaluateRouteCandidates({
        mission: baseMission(),
        capabilityInstances: [fact(baseInstance(), "read")],
        now: NOW,
        idSeed: 0,
      }),
    ).toThrow(ContractValidationError);

    expect(() =>
      evaluateRouteCandidates({
        mission: baseMission(),
        capabilityInstances: [
          { instance: baseInstance(), side_effect: "banana" } as unknown as RouteInstanceFact,
        ],
        now: NOW,
        idSeed: 1,
      }),
    ).toThrow(ContractValidationError);

    expect(() =>
      evaluateRouteCandidates({
        mission: { ...baseMission(), objective: "" },
        capabilityInstances: [],
        now: NOW,
        idSeed: 1,
      }),
    ).toThrow(ContractValidationError);
  });
});
