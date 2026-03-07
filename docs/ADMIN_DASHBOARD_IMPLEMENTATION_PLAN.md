# OCO Admin Dashboard Implementation Plan

## 1. Goal
Build a production-grade OCO admin dashboard plus standalone API for end-to-end organization and agent management, with database-backed state as source of truth.

## 2. Scope

### In Scope
- Walkthrough wizard for onboarding organizations and inventories.
- Walkthrough wizard for configuring and running agents.
- Overview page for organization/instance/agent status with channel visibility.
- Agent details page for status and core configuration:
  - souls and tools
  - active model
  - key agent-specific config fields
- Settings pages:
  - global settings
  - model provider monitoring (OpenAI + Anthropic initially)
  - API key management with secure storage and redaction
- Clean dashboard IA with collapsible left navigation.
- API and database layer usable independently from dashboard.
- Migration from inventory/config files to database.
- Dashboard stack deployable on Docker and Kubernetes.
- One-command full stack deployment (orchestration + dashboard).
- Local stack that supports quick testing and UI hot reload.

### Out of Scope (Initial Release)
- Billing/monetization.
- Multi-region HA control plane.

## 3. Architecture

## 3.1 Components
- `src/admin` (`admin-api`)
  - REST endpoints
  - auth/RBAC
  - validation and policy checks
  - runtime orchestration actions
- `dashboard/` (`admin-web`)
  - React + Vite client served under `/admin`
  - dashboard UI and onboarding wizards
- `admin-worker` (phase 2)
  - usage ingestion
  - cost rollups
  - health snapshots
- `src/` (`oco-core`)
  - inventory/policy domain logic
  - validation rules
  - migration import/export
- `postgres` (new primary DB)

## 3.1.1 Repository Layout (Current Transition)
- Keep implementation in a top-level `src/` tree for now.
- Use internal module boundaries (`src/admin` vs orchestration modules) instead of multiple backend packages.
- Keep `dashboard/` as a standalone React + Vite workspace package because it has separate toolchain/build output.

## 3.2 Source of Truth
- Post-cutover, database is canonical state.
- Inventory files become import/export compatibility artifacts.
- Existing CLI transitions to shared `oco-core` services over time.

## 3.3 Deployment Topology
- Docker stack:
  - `admin-api`, `admin-web`, `admin-worker`, `postgres`
  - existing OCO orchestration runtime services
- Kubernetes stack:
  - Deployments for API/web/worker
  - Postgres as managed service or StatefulSet
  - namespace/context/kubeconfig driven config

## 4. Data Model (Initial)

## 4.1 Core Tables
- `organizations`
- `organization_settings`
- `instances`
- `instance_paths`
- `instance_channels`
- `channel_accounts`
- `agents`
- `agent_bindings`
- `agent_models`
- `agent_souls`
- `agent_tools`
- `policy_scopes`
- `policy_integrations`
- `policy_skills`
- `policy_models`
- `provider_accounts`
- `provider_api_keys` (encrypted)
- `model_catalog`
- `model_usage_events`
- `model_usage_rollups_daily`
- `provider_usage_ingest_runs`
- `deployment_revisions`
- `audit_events`
- `inventory_import_runs`
- `inventory_export_runs`

## 4.2 Constraints
- Agent belongs to exactly one instance.
- A channel/account route maps deterministically to one target agent.
- Instance gateway port ranges must not overlap in an organization.
- Secrets are write-only and never returned in plaintext.
- Mutable writes generate audit records.

## 5. API Design (v1)

All routes under `/api/v1`.

## 5.1 Onboarding
- `POST /onboarding/organization`
- `POST /onboarding/organization/validate`
- `POST /onboarding/organization/commit`
- `POST /onboarding/agent`
- `POST /onboarding/agent/validate`
- `POST /onboarding/agent/commit`

## 5.2 Org/Inventory/Settings
- `GET /organizations`
- `GET /organizations/:orgId`
- `PATCH /organizations/:orgId`
- `GET /organizations/:orgId/overview`
- `GET /organizations/:orgId/settings`
- `PATCH /organizations/:orgId/settings`
- `POST /organizations/:orgId/inventory/import`
- `POST /organizations/:orgId/inventory/export`

## 5.3 Instances and Runtime
- `GET /organizations/:orgId/instances`
- `POST /organizations/:orgId/instances`
- `PATCH /instances/:instanceId`
- `DELETE /instances/:instanceId`
- `POST /instances/:instanceId/runtime/render`
- `POST /instances/:instanceId/runtime/deploy`
- `POST /instances/:instanceId/runtime/restart`
- `GET /instances/:instanceId/health`

## 5.4 Agents
- `GET /instances/:instanceId/agents`
- `POST /instances/:instanceId/agents`
- `GET /agents/:agentId`
- `PATCH /agents/:agentId`
- `DELETE /agents/:agentId`
- `POST /agents/:agentId/soul/apply`
- `POST /agents/:agentId/tools/apply`

## 5.5 Provider Usage and Keys
- `GET /settings/providers`
- `POST /settings/providers/:provider/keys`
- `DELETE /settings/providers/:provider/keys/:keyId`
- `GET /usage/providers`
- `GET /usage/providers/:provider/models`
- `GET /usage/agents/:agentId`

## 5.6 Auth and Audit
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /audit-events`
- `GET /healthz`
- `GET /readyz`

## 6. Dashboard UX Plan

Left navigation (collapsible):
- Onboarding
- Overview
- Organizations
- Instances
- Agents
- Settings
- Audit

## 6.1 Organization Onboarding Wizard
1. Org identity + deployment provider
2. Policy defaults
3. Initial instance/channels/accounts
4. Validation summary
5. Commit + optional deploy

## 6.2 Agent Onboarding Wizard
1. Instance target + role
2. Channel/account binding
3. Model + integrations + skills
4. Souls/tools
5. Validation + commit + optional rollout

## 6.3 Overview Page
- Organization health summary
- Instance status cards
- Running agents and channel mapping
- Recent deploy and audit events

## 6.4 Agent Details Page
- Runtime status
- Effective model and policy
- Souls/tools assignments
- Bindings/integrations/skills
- Usage and cost summary

## 7. Deployment and Developer Workflow

## 7.1 One-Command Stack Deployment
Add stack commands:
- `oco stack up --provider docker`
- `oco stack up --provider kubernetes`
- `oco stack down --provider docker|kubernetes`
- `oco stack status`

`stack up` brings up:
- dashboard control-plane services
- required data services
- orchestrator runtime components

## 7.2 Local Development
Add dev commands:
- `oco dev up`
- `oco dev down`
- `oco dev logs`
- `bun run dashboard:dev`
- `bun run dashboard:build`

Expectations:
- UI hot reload.
- API/worker fast restart.
- Seeded local Postgres fixtures for dashboard testing.

## 8. Migration Plan (Files -> DB)

## 8.1 Steps
1. Parse and validate inventory + overrides.
2. Dry-run import with parity checks.
3. Commit DB snapshot transaction.
4. Emit export compatibility artifacts.
5. Switch dashboard/API writes to DB.

## 8.2 Safety Gates
- Backup before destructive migration.
- Parity with `oco validate` and `oco policy validate`.
- Render parity checks against current workflow.
- Route uniqueness enforcement.

## 9. Security Model
- Roles: `admin`, `operator`, `viewer`.
- Auth: session/JWT initially; OIDC extension point preserved.
- Provider keys:
  - envelope encryption at rest
  - write-only input UX
  - redacted outputs
- Guardrails:
  - no arbitrary environment variable editing in dashboard
  - model changes must pass policy checks and RBAC
- Full audit logging for mutable actions.

## 10. Testing Plan

## 10.1 Unit Tests
- Validation and merge logic.
- Policy resolution precedence.
- Cost attribution math.
- Secret encryption/redaction.

## 10.2 API Contract Tests
- Request/response schemas.
- Error semantics.
- RBAC route enforcement.

## 10.3 Integration Tests
- DB transactions and repositories.
- Import/export parity.
- Runtime action adapters.
- Usage ingestion and rollups.

## 10.4 Dashboard E2E Tests
- Org onboarding wizard.
- Agent onboarding wizard.
- Overview page rendering.
- Agent details update flows.
- Provider key write/redaction behavior.

## 10.5 Deployment Smoke Tests
- `stack up/down/status` on local Docker.
- `stack up/status` on Kubernetes test namespace.
- Health checks for dashboard services and sample instance.

## 10.6 Performance Tests
- Overview load with >= 50 agents.
- Usage rollup throughput at realistic event volume.
- API latency targets for core CRUD and overview endpoints.

## 10.7 CI Updates
- Keep existing CLI tests.
- Add API unit/integration jobs.
- Add dashboard unit/e2e jobs.
- Add migration parity tests.
- Add stack smoke tests (Docker required, Kubernetes dedicated job).

## 11. Phased Delivery

## Phase 0: Decision Lock and Contracts
- Resolve open decisions.
- Freeze DB schema and API contracts.
- Freeze acceptance tests per feature.

## Phase 1: Foundation
- Implement `oco-core`.
- Scaffold API/web/worker.
- Implement auth, RBAC, audit, org/instance/agent CRUD.

## Phase 2: Onboarding + Overview
- Build both onboarding wizards.
- Build overview status views.
- Add validation-first commit flows.

## Phase 3: Agent Details + Settings
- Build agent details configuration workflows.
- Build global settings and provider key workflows.

## Phase 4: Usage and Cost Monitoring
- OpenAI and Anthropic ingestion.
- Rollups and per-agent attribution model.
- Provider/model/agent usage views.

## Phase 5: Stack Deploy + Migration Cutover
- Implement `oco stack` + `oco dev`.
- Finalize Docker/Kubernetes deployment artifacts.
- Run migration and cutover with rollback runbook.

## Phase 6: Hardening
- Performance tuning.
- Security hardening.
- Ops runbook validation.

## 12. Definition of Done
- All dashboard/API requirements in this plan implemented.
- All planned test layers green in CI.
- One-command Docker and Kubernetes stack deployment validated.
- Local dev workflow with UI hot reload validated.
- Migration runbook validated against real inventory data.
- Security requirements for secrets and RBAC verified.

## 13. Decision Lock (Phase 1)
1. **DB baseline**
- Locked: PostgreSQL for production deployments; SQLite-compatible local mode for dev/test.

2. **Auth baseline**
- Locked: local auth + RBAC (`admin`, `operator`, `viewer`) first, OIDC extension points preserved.

3. **Usage attribution policy**
- Locked: attribute usage when key scope is known; otherwise place usage in explicit unattributed bucket.

4. **CLI transition approach**
- Locked: no dual-write path; DB is write source with inventory export compatibility.

5. **Secrets backend**
- Locked: envelope encryption via `OCO_ADMIN_MASTER_KEY`; external secret manager can be added later.

6. **Deployment authority**
- Locked: deploy actions restricted to admin; operator can prepare/stage only.

## 14. Parallel Workstreams
- Stream A: `oco-core` + migration/parity checks.
- Stream B: API + auth/RBAC + audit.
- Stream C: Dashboard onboarding + overview.
- Stream D: Agent details + settings + provider key UX.
- Stream E: Usage/cost ingestion + reporting.
- Stream F: Stack/dev deployment commands + packaging.

Each stream ships with tests and clear acceptance criteria.
