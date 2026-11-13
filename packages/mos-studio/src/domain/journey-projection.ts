/**
 * 旅程投影（纯函数）：把 @mos/* 的领域对象投影成面板/工具返回的展示形状。
 * 只投影、绝不改写领域对象；counts/shapes 优先，绝不复制 provider 记录内容。
 */
import type { CapabilityInstance } from "@mos/capabilities";
import type { ProviderConnection } from "@mos/contracts";
import type { Mission } from "@mos/missions";
import type { Route, RouteCandidateSummary } from "@mos/routes";

export interface MissionView {
  readonly id: string;
  readonly status: string;
  readonly objective: string;
  readonly source_zcode_session_id: string | null;
  readonly source_zcode_task_id: string | null;
  readonly created_at: string;
}

export function missionView(mission: Mission): MissionView {
  return {
    id: mission.id,
    status: mission.status,
    objective: mission.objective,
    source_zcode_session_id: mission.source_zcode_session_id ?? null,
    source_zcode_task_id: mission.source_zcode_task_id ?? null,
    created_at: mission.created_at,
  };
}

export interface ConnectionView {
  readonly id: string;
  readonly provider_id: string;
  readonly auth_method: string;
  readonly status: string;
  readonly credential_ref: string;
  readonly granted_scopes: readonly string[];
}

export function connectionView(connection: ProviderConnection): ConnectionView {
  return {
    id: connection.id,
    provider_id: connection.provider_id,
    auth_method: connection.auth_method,
    status: connection.status,
    credential_ref: connection.credential_ref,
    granted_scopes: [...connection.granted_scopes],
  };
}

export interface CapabilityInstanceView {
  readonly capability_id: string;
  readonly implementation_id: string;
  readonly status: string;
  readonly support_status: string;
  readonly missing_preconditions: readonly string[];
  readonly tool_mapping_verified: boolean;
}

export function capabilityInstanceView(
  instance: CapabilityInstance,
  toolMappingVerified: boolean,
): CapabilityInstanceView {
  return {
    capability_id: instance.capability_id,
    implementation_id: instance.implementation_id,
    status: instance.status,
    support_status: instance.support_status,
    missing_preconditions: [...instance.missing_preconditions],
    tool_mapping_verified: toolMappingVerified,
  };
}

export interface RouteView {
  readonly route_id: string;
  readonly route_class: string;
  readonly side_effect: string;
  readonly approvals: readonly string[];
  readonly unknowns: readonly string[];
}

export function routeView(route: Route): RouteView {
  return {
    route_id: route.id,
    route_class: route.route_class,
    side_effect: route.steps.map((step) => step.side_effect).join("|"),
    approvals: [...route.approvals],
    unknowns: [...route.unknowns],
  };
}

export interface RoutesView {
  readonly mission_id: string;
  readonly routes: readonly RouteView[];
  readonly summary: Record<string, number>;
}

export function routesView(
  missionId: string,
  routes: readonly Route[],
  summary: RouteCandidateSummary,
): RoutesView {
  return {
    mission_id: missionId,
    routes: routes.map(routeView),
    summary: {
      existing: summary.existing,
      conditional: summary.conditional,
      blocked: summary.blocked,
      unknown: summary.unknown,
      total: summary.total,
    },
  };
}
