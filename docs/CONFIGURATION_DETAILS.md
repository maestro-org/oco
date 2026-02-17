# Configuration Details

This document explains how `oco` configuration is structured, merged, and applied.

## 1. Source of Truth
- `inventory/instances.yaml`: main control-plane inventory.
- `templates/openclaw/*.json5`: reusable baseline layers.
- `instances/<id>/config/instance.overrides.json5`: instance-specific overrides.

Generated runtime files (do not commit):
- `.generated/<instance>/openclaw.resolved.json`
- `instances/<instance>/config/openclaw.json5`
- `.generated/<instance>/docker-compose.yaml`

## 2. Render and Merge Order
For each instance, `oco` resolves config in this order:
1. Inventory-defined layer order (`openclaw.config_layers`)
2. Runtime overlay derived from inventory (`gateway`, `agents`, `bindings`, `channels`)
3. Environment variable substitution (`${VAR}` / `${VAR:-fallback}`)

Later layers override earlier ones.

## 3. Inventory Structure

## 3.1 Top-level
- `version`: inventory schema version (`1`).
- `organization`: org metadata (`org_id`, `org_slug`, `display_name`).
- `defaults`: org-wide defaults.
- `instances`: list of gateway instances.

## 3.2 `defaults`
- `port_stride`: reserved port range window per instance.
- `policy.integrations`: integration allow/deny rules.
- `policy.skills`: skill allow/deny and source controls.
- `policy.models`: provider/model allow/deny controls.

## 3.3 `instances[]`
- `id`: unique instance id.
- `enabled`: include instance in lifecycle operations.
- `profile`: logical profile (`human`, `usecase`, etc.).
- `host`: bind and gateway port.
- `paths`: config/state/workspace/generated paths.
- `openclaw.config_layers`: ordered JSON5 layer list.
- `openclaw.docker`: image/container/restart/env overrides.
- `policy`: instance-level policy overrides.
- `channels`: channel account configuration input.
- `agents`: agent definitions and routing.

## 4. Agent Configuration
Each `instances[].agents[]` entry supports:
- `id`: required unique id in instance.
- `role`: operational role (`human`, `usecase`).
- `workspace`: workspace name/path suffix.
- `agent_dir`: state dir suffix.
- `model`: model id, e.g. `openai/gpt-5-nano`.
- `integrations`: expected integration allowlist for policy checks.
- `skills`: optional skill names for policy checks.
- `skill_sources`: allowed skill sources (`bundled`, `managed`, `workspace`).
- `bindings`: channel routing matchers.

Runtime rendering maps these to OpenClaw `agents.list[]` and binding routes.

## 5. Bindings and Routing
`bindings` map inbound channel/account traffic to a specific agent.

Example:
```yaml
bindings:
  - match:
      channel: telegram
      accountId: owner
```

Validation enforces no duplicate `channel:accountId` binding inside an instance.

## 6. Policies and Precedence
Effective policy precedence:
1. `defaults.policy` (org-wide)
2. `instances[].policy` (instance override)
3. agent-level inferred checks (model/integration/skill fields)

Use:
```bash
oco policy validate
oco policy effective --instance <id>
oco policy effective --instance <id> --agent-id <agent-id>
```

## 7. Environment Variables
Common variables:
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`
- channel-specific vars such as `TELEGRAM_BOT_TOKEN_*`

Use env references in JSON5 layers:
```json5
{
  gateway: {
    auth: {
      token: "${OPENCLAW_GATEWAY_TOKEN}",
    },
  },
}
```

## 8. Compose Generation
`oco compose generate --instance <id>` produces a per-instance compose manifest with:
- isolated mounts for config/state/workspaces
- bound host port from inventory
- container env for OpenClaw paths
- passthrough provider keys from shell env when present

## 9. Safety Rules for OSS Repos
Do not commit:
- `.env` and local env variants
- rendered runtime config files under `instances/*/config/openclaw.json5*`
- `instances/*/state/**` and `instances/*/workspaces/**`

Recommended checks before pushing:
```bash
git status
rg -n "sk-proj-|botToken\":\"|BEGIN PRIVATE KEY|OPENAI_API_KEY=" . --glob '!node_modules/**' --glob '!.git/**'
```

## 10. Validation and Deployment Flow
```bash
set -a
source .env
set +a

oco validate
oco policy validate
oco preflight --instance core-human

oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```
