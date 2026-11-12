# Provider integration strategy

## 1. Purpose

Make the existing ZCode plugin/MCP/OAuth/tool infrastructure useful to MOS without making plugin metadata the source of truth for marketing capability or account authorization.

## 2. Integration layers

1. Provider documentation: authoritative description of API operations, eligibility, scopes, quotas, policy and review constraints.
2. ZCode connector: installable plugin/MCP service/OAuth provider integration. Keep the existing ZCode plugin.json and MCP configuration contracts unchanged.
3. MOS provider adapter: maps actual tool/API operations to MOS provider-neutral commands and normalizes provider errors, scopes, evidence, side effects and idempotency.
4. MOS capability descriptor: versioned metadata adjacent to a connector package; maps a capability to the exact MCP tool/API operation, schemas, required scopes, side-effect and constraints.
5. Capability instance resolver: checks a specific tenant's connection, account type, scopes, provider app review, quota and current operational evidence.
6. Route planner: uses verified capability instances and conditional preconditions to plan work.
7. ZCode runtime: executes tools through its existing tool executor and permission boundary.

## 3. Capability descriptor

A descriptor must include:
- stable capability ID and version;
- provider and integration package identifiers;
- exact tool name or API operation;
- input and output schemas, with version;
- side-effect class and risk;
- required OAuth scopes/account types/app review;
- required account/tenant/user context;
- rate limits and cost model, when known;
- latency and region restrictions, when known;
- data read/written and retention sensitivity;
- required ZCode permission/approval mode;
- evidence source and verification method;
- known gaps and status (supported, unsupported, unknown);
- implementation status (available, degraded, unavailable, unknown);
- fallback and reconciliation rules.

The descriptor advertises possible mapping; account resolver determines actual capability instance. Never treat a descriptor as authorization.

## 4. Existing plugin infrastructure rules

- Do not change ZCode plugin manifest schema to add marketing-specific fields.
- Place MOS descriptors in an adjacent manifest file or package directory, and version it independently.
- Keep plugin install/update/enable/disable/marketplace behavior owned by ZCode.
- Reuse MCP OAuth and credential store. Do not implement duplicate secret storage.
- Use ordinary MCP tools for broad platform coverage. Desktop-local plugin UI can enhance an experience but may not be the only way a capability works.
- Use ZCode ToolSearch/deferred exposure for large catalogs. Do not expose every tool in every agent context.
- Hooks may observe/assist a flow, but they cannot become a second permission or policy authority.
- Plugin installation is not permission to publish, send messages, spend, delete or modify an external account.

## 5. Prioritization

Prioritize by user value, accessible real API, authorization friction, reliability, quota/cost and end-to-end demonstrability. Do not prioritize solely by brand popularity.

Initial candidates:
- HubSpot remote MCP / CRM: strong early candidate for customer records and CRM-context workflows; verify OAuth connection, user-specific permissions and exact tool operations before mapping.
- YouTube Data API: useful for channel/video metadata and upload workflows; publish requires OAuth and quota planning.
- Google Analytics Data API and Search Console: useful measurement and organic-search evidence, subject to user authorization and site/property access.
- Meta / Instagram: separate account type, product and login-path constraints; do not assume personal Instagram accounts or all publishing surfaces are eligible.
- TikTok: Content Posting API requires the relevant authorization and privacy controls; unaudited client limitations can prevent public publishing.
- LinkedIn: API access tiers and app review can gate content and analytics capabilities.
- X: API access and costs are request/resource dependent; make cost visible before use.
- Canva: useful creative workflow, but exact API access/scopes may depend on plan.
- Ahrefs/Semrush: useful SEO/market intelligence but generally paid/usage-limited.

Provider-specific status, scopes and policy requirements must be rechecked from official docs immediately before implementation and stored in a provider evidence record. This document is a strategy, not a promise that all APIs are available to all users.

## 6. Initial vertical and acceptance

Preferred first proof is a CRM-informed marketing task using an officially authorized HubSpot connection plus one real measurement or content data source when account access exists. The TL may select a different vertical only if it yields a shorter, safer, genuinely live end-to-end proof; record the reason in the implementation-state document.

Minimum proof:
- connect an actual authorized test account through official OAuth or official MCP authorization;
- enumerate current scopes and account identity without leaking secrets;
- make one real read operation and record safe provider evidence;
- resolve at least one MOS capability instance based on that connection;
- use existing ZCode New Task to start a MOS-assisted task, preserving ordinary task controls;
- show an existing/conditional route distinction and explain any missing prerequisite;
- prove the permission boundary blocks a disallowed write;
- if a safe sandbox write is available, preview and approve it through existing ZCode permissions, execute once, and reconcile result; otherwise mark live write as blocked/deferred and do not simulate it as success.

No provider write is to be attempted against a production account without explicit user approval.

## 7. Evidence and provider gates

For every adapter, save:
- official doc URL and observed date;
- exact API/MCP server/version/tool names;
- OAuth client/app state and approved scopes (never secret values);
- account type and tenant eligibility;
- test account identity in redacted/safe form;
- API request/response correlation IDs with sensitive data removed;
- actual request/response evidence and timestamp;
- quota/rate limit result;
- negative tests for revoked auth, missing scope, unauthorized target and rate limit;
- limitations, review status and fallback;
- reproducible test commands and exact source commit.

Mocks support contract tests only. The integration is verified only with real provider evidence.
