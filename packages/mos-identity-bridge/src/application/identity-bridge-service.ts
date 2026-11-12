import type { SessionFactsPort } from "@mos/adapters";
import { parseOrFail, tenantContextSchema } from "@mos/contracts";
import type { TenantContext } from "@mos/contracts";
import { resolveTenantContext, tenantUnavailableReason } from "../domain/resolve-tenant.js";
import type { TenantResolution } from "../contract.js";

/**
 * 身份桥服务：经 SessionFactsPort 读取事实并解析 TenantContext。
 * 解析结果必须通过 mos-contracts 契约校验（fail-closed 到 tenant_context_invalid）。
 */
export class IdentityBridgeService {
  private readonly sessionFacts: SessionFactsPort;

  constructor(deps: { sessionFacts: SessionFactsPort }) {
    this.sessionFacts = deps.sessionFacts;
  }

  async resolveTenantContext(): Promise<TenantResolution> {
    const [session, user] = await Promise.all([
      this.sessionFacts.currentSession(),
      this.sessionFacts.currentUser(),
    ]);
    const unavailable = tenantUnavailableReason(session, user);
    if (unavailable) return { status: "unavailable", reason: unavailable };

    const mapped = resolveTenantContext(session, user);
    if (!mapped) {
      return { status: "unavailable", reason: "tenant_context_invalid" };
    }
    try {
      const tenantContext = parseOrFail(
        "TenantContext",
        tenantContextSchema,
        mapped,
      ) as TenantContext;
      return { status: "resolved", tenantContext };
    } catch {
      return { status: "unavailable", reason: "tenant_context_invalid" };
    }
  }
}
