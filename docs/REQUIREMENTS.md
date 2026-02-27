# OpenClaw Orchestrator Requirements

## 1. Motivation
Build a unified control plane for deploying, configuring, operating, and updating multiple isolated OpenClaw agent runtimes for a configurable organization.

The platform must support both:
- Human-coupled agents (1:1 identity ownership).
- Use-case agents (task or domain specific).

Each agent must have a distinct account identity and isolated runtime state.
Organization identity (for example `org_id`, `org_slug`, `display_name`) must be configuration-driven and never hardcoded.

## 2. Product Goals
1. Operate many OpenClaw agents across Docker and Kubernetes gateway instances.
2. Keep security boundaries explicit and enforceable by default.
3. Make onboarding, updates, and decommissioning fast and repeatable.
4. Support shared configuration templates with per-gateway and per-agent overrides.
5. Provide clear operational visibility and auditable change history.

## 3. Scope
### In scope
- Multi-instance gateway orchestration via Docker Compose and Kubernetes.
- Agent and account lifecycle management.
- Config template layering and inheritance.
- Integration cataloging and policy management.
- Skills cataloging and policy management.
- Model provider/model policy management.
- Update rollout and rollback.
- Security controls, secret handling, and audit logging.
- Day-2 operations (health checks, diagnostics, backup/restore).

### Out of scope (initial phases)
- Building a custom inference engine.
- Replacing OpenClaw channel implementations.
- Cross-org billing and monetization.
- Fully autonomous policy decisions without admin review.

## 4. OpenClaw Constraints and Facts (Docs-Aligned)
1. One gateway can host multiple agents and multiple channel accounts.
2. Multiple gateways are valid for strict isolation or redundancy.
3. Multi-gateway on same host requires isolated config path, state dir, workspace roots, and non-overlapping ports.
4. Agent isolation depends on unique `workspace`, `agentDir`, sessions, and auth profiles.
5. Per-account routing is done through channel `accounts.*` plus `bindings[].match.accountId`.
6. Config supports JSON5, `$include`, deep merge behavior, and env-var substitution.
7. Device pairing, gateway auth, and doctor/update flows are first-class operational controls.
8. Notion and HeyGen are not built-in integrations today; they require custom skill/plugin or browser automation.
9. Skills are loaded from bundled, managed/local (`~/.openclaw/skills`), and workspace (`<workspace>/skills`) locations with precedence.
10. Model selection uses `provider/model`; provider/model access can be constrained by allowlists.

## 5. Target Operating Model
### Tenancy model
- Organization has many gateway instances.
- Each gateway instance has one trust level and one operational profile.
- Each gateway instance contains one or more agents.
- Organization metadata is runtime-configurable and can support multiple org profiles over time.

### Isolation model
- Human-coupled agents use stricter isolation by default.
- Use-case agents may share gateways when risk profile is compatible.
- Every agent has:
  - Unique agent id.
  - Unique account id per channel.
  - Unique workspace and state paths.
  - Explicit sandbox and tool policy.

### Deployment model
- Gateways run on one of two org-selected providers: Docker Compose or Kubernetes.
- Config and state persistence strategy depends on provider (host volumes, PVCs, or equivalent).
- Secrets come from environment or secret store, not hardcoded in repo.

### Policy scope model
- Org-wide defaults define the baseline for integrations, skills, and model providers/models.
- Gateway/group policy overrides can tighten or extend org defaults.
- Agent-level policy overrides can further restrict or specialize behavior.
- Effective policy is resolved deterministically with explicit precedence: org -> gateway/group -> agent.

## 6. Functional Requirements

### FR-01: Gateway Instance Lifecycle
The orchestrator must:
1. Create, start, stop, restart, and remove gateway instances.
2. Ensure per-instance isolation of:
   - `OPENCLAW_CONFIG_PATH`
   - `OPENCLAW_STATE_DIR`
   - workspace root
   - gateway port range
3. Support profile-driven instance generation (for example `human`, `usecase`, `rescue`).
4. Detect and prevent port/state/config collisions before deploy.

Acceptance criteria:
1. A new instance can be provisioned from template in one command or UI action.
2. Validation fails fast on overlapping ports or shared state paths.
3. Instance status is visible (`running`, `degraded`, `stopped`, `failed`).

### FR-02: Agent Lifecycle
The orchestrator must:
1. Add, list, update, and delete agents.
2. Enforce one unique account identity per agent.
3. Provision unique agent workspace and state folders.
4. Attach agent to a gateway and binding rules deterministically.
5. Support both CLI-driven and API/UI-driven onboarding.

Acceptance criteria:
1. Onboarding creates agent config, account mapping, and binding atomically.
2. Deletion cleans routing and can archive state safely.
3. `agents list` output is exposed in orchestrator inventory.

### FR-03: Account and Routing Management
The orchestrator must:
1. Manage per-channel accounts (`channels.<provider>.accounts.<accountId>`).
2. Route traffic with `bindings` by channel and account id.
3. Support default and wildcard routing only when explicitly configured.
4. Show effective routing table and conflict warnings.

Acceptance criteria:
1. Each account id maps to one intended agent path.
2. Routing conflict detection blocks unsafe deploys.

### FR-04: Configuration Layering
The orchestrator must support config layers:
1. Org-wide base templates.
2. Gateway/group templates.
3. Agent-specific overrides.
4. Secret and environment substitutions.

Rules:
1. Use JSON5 + `$include`.
2. Deterministic merge order must be documented and testable.
3. Effective resolved config must be previewable before apply.
4. Changes must be version-controlled and auditable.

Acceptance criteria:
1. Any effective config can be traced back to source layers.
2. Dry-run shows rendered result and validation errors.

### FR-05: Security and Access Control
The orchestrator must:
1. Default gateway bind to loopback unless explicitly remote-enabled.
2. Require gateway auth token/password for non-loopback exposure.
3. Integrate device pairing approval workflow.
4. Support role-based operator access (at least admin and operator roles).
5. Enforce least privilege tool/sandbox policy per agent.
6. Rotate and revoke device tokens.

Acceptance criteria:
1. Remote access without auth is blocked by policy.
2. Token rotation and revocation actions are logged.

### FR-06: Update and Rollback
The orchestrator must:
1. Support staged updates by environment or instance group.
2. Run preflight checks (`doctor`, health, channel probes) during rollout.
3. Restart gateways safely after update.
4. Support rollback to previous known-good version/config.

Acceptance criteria:
1. Canary update flow exists and is scriptable.
2. Failed health gate triggers automatic rollback.

### FR-07: Observability and Operations
The orchestrator must expose:
1. Gateway health and status.
2. Channel readiness/probe status.
3. Agent inventory and binding inventory.
4. Centralized logs and recent error summaries.
5. Diagnostics links or command wrappers for doctor/logs/status.

Acceptance criteria:
1. Admin can identify failed instance and root cause path within minutes.
2. Alerts are available for down/degraded states.

### FR-08: Backup and Disaster Recovery
The orchestrator must:
1. Back up config repositories and host state directories on schedule.
2. Support point-in-time restore for an instance.
3. Document RPO and RTO targets.
4. Validate restore workflow in drills.

Acceptance criteria:
1. Restore runbook is tested at least once per quarter.
2. Backup integrity checks are automated.

### FR-09: Supported Integrations Catalog and Policy
The orchestrator must maintain an explicit integration catalog with docs-aligned classifications:
1. Core/built-in channels (for example WhatsApp, Telegram, Discord, Slack, Signal, Google Chat, IRC, iMessage/BlueBubbles, WebChat).
2. Plugin channels/extensions (for example Mattermost, Microsoft Teams, Feishu/Lark, LINE, Matrix, Zalo, Zalo Personal, Nextcloud Talk, Nostr, Twitch, Tlon).
3. Non-built-in integrations tracked as custom-only (for example Notion and HeyGen via skill/plugin).
4. Integration support metadata (status, install method, trust tier, owner).

Policy behavior:
1. Org-level integration allow/deny baseline.
2. Gateway/group-level integration overrides.
3. Agent-level integration overrides.
4. Validation must block deployment when an instance/agent uses an integration denied by policy.

Acceptance criteria:
1. Effective integration policy can be listed for any org/gateway/agent.
2. Policy conflict and unsupported integration usage are detected pre-deploy.

### FR-10: Skills Management and Scope
The orchestrator must:
1. Manage skill sources (bundled, managed/local, workspace, optional shared dirs).
2. Support skill policy at org, gateway/group, and agent scopes.
3. Support allowlist/denylist semantics and precedence.
4. Track skill provenance (source, version/ref, owner, risk tier).
5. Support per-agent custom skills without leaking to other agents unless explicitly shared.

Acceptance criteria:
1. Effective skill list for an agent is previewable before deployment.
2. Skill policy violations (for example disallowed source or disallowed skill) fail validation.

### FR-11: Model Provider and Model Policy Management
The orchestrator must:
1. Catalog supported model providers and approved model references (`provider/model`).
2. Define model policy at org, gateway/group, and agent scopes.
3. Support approved/blocked provider lists and approved/blocked model lists.
4. Support risk-based model tiers (for example default, high-cost, high-trust).
5. Prevent deployment when configured models violate effective policy.

Acceptance criteria:
1. Effective model policy and selected model are visible for every agent.
2. Unauthorized provider/model configuration is blocked during preflight.

## 7. Non-Functional Requirements
1. Security: least privilege by default, no plain-text secrets in git.
2. Reliability: target 99.9% monthly control-plane availability.
3. Recoverability: RPO <= 24h, RTO <= 4h for a single gateway.
4. Scalability: support at least 50 agents in phase 1 design without re-architecture.
5. Performance: config render + validation for one org completes in <= 10 seconds.
6. Auditability: every config change linked to actor, timestamp, and diff.
7. Policy determinism: effective integration/skill/model policy resolution is deterministic and test-covered.

## 8. Data and Configuration Model
Minimum orchestrator objects:
1. Organization
2. GatewayInstance
3. Agent
4. ChannelAccount
5. Binding
6. ConfigTemplate
7. ConfigOverride
8. SecretRef
9. DeploymentRevision
10. AuditEvent
11. IntegrationCatalogEntry
12. IntegrationPolicy
13. SkillPolicy
14. ModelPolicy

Required relations:
1. Agent belongs to exactly one GatewayInstance.
2. ChannelAccount belongs to one GatewayInstance and maps to one Agent.
3. Binding references one Agent and one channel/account match set.
4. Effective config is derived from template layers + overrides + secret refs.
5. Effective integration/skill/model policy is derived from org + gateway/group + agent layers.

## 9. Phased Delivery Plan

### Phase 1: CLI-First Orchestrator MVP
Deliver:
1. Inventory file/schema for instances and agents.
2. Template renderer with `$include` layering.
3. Runtime deployers for Docker Compose and Kubernetes.
4. Agent/account/binding lifecycle commands.
5. Health checks and preflight validation.
6. Update + rollback scripts.
7. Integration, skill, and model policy validation with effective-policy preview commands.

Exit criteria:
1. Admin can add/remove agent in <= 10 minutes with no manual file edits.
2. A rolling update across at least 3 instances is successful with health gates.
3. Preflight blocks disallowed integration, skill, or model configurations.

### Phase 2: Operator Dashboard
Deliver:
1. Authenticated UI for inventory, status, and lifecycle actions.
2. Form-driven onboarding for gateway and agent creation.
3. Routing and effective-config visualization.
4. Device pairing and approval workflows in UI.

Exit criteria:
1. New operator can onboard an agent without direct shell access.
2. UI reflects real-time instance and channel health.

### Phase 3: Advanced Governance and Policy
Deliver:
1. Policy packs by risk tier (human, public, internal automation).
2. Approval workflows for high-risk config changes.
3. Drift detection and auto-remediation options.
4. Backup/restore drill automation and compliance reports.

Exit criteria:
1. Policy violations are blocked pre-deploy.
2. Compliance report can be generated for any quarter.

## 10. Risks and Mitigations
1. Misconfigured shared state paths can break isolation.
   - Mitigation: strict validation and immutable path generation.
2. Account routing conflicts can misroute user messages.
   - Mitigation: deterministic routing visualization + conflict blocker.
3. Unsafe remote exposure of gateway endpoints.
   - Mitigation: secure defaults, mandatory auth, device approval workflow.
4. Upgrade regressions in fast-moving OpenClaw versions.
   - Mitigation: canary rollouts, pinned revisions, rollback automation.

## 11. References
1. https://docs.openclaw.ai/
2. https://docs.openclaw.ai/install/docker
3. https://docs.openclaw.ai/gateway/multiple-gateways
4. https://docs.openclaw.ai/concepts/multi-agent
5. https://docs.openclaw.ai/gateway/configuration
6. https://docs.openclaw.ai/gateway/configuration-reference
7. https://docs.openclaw.ai/cli/agents
8. https://docs.openclaw.ai/cli/devices
9. https://docs.openclaw.ai/install/updating
10. https://docs.openclaw.ai/gateway/doctor
11. https://docs.openclaw.ai/channels/index
12. https://docs.openclaw.ai/plugins
13. https://docs.openclaw.ai/skills
14. https://docs.openclaw.ai/providers
15. https://docs.openclaw.ai/help/faq
