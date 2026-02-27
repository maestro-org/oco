# Configuration Details

This document describes how `oco` configuration is sourced, merged, and validated.

## 1. Source of Truth
- `inventory/instances.example.yaml`: tracked reference template.
- `inventory/instances.local.yaml`: recommended local inventory (gitignored).
- `inventory/instances.yaml`: fallback tracked inventory.
- `templates/openclaw/*.json5`: shared base config layers.
- `instances/<id>/config/instance.overrides.example.json5`: tracked override examples.
- `instances/<id>/config/instance.overrides.json5`: local overrides (gitignored).

Inventory resolution order:
1. `--inventory <path>`
2. `OCO_INVENTORY_PATH`
3. `inventory/instances.local.yaml` (if present)
4. `inventory/instances.yaml`

## 2. Render and Merge Order
For each instance, `oco` applies:
1. `openclaw.config_layers` in listed order
2. runtime overlay from inventory (`gateway`, `agents`, `bindings`, `channels`)
3. environment substitution (`${VAR}` / `${VAR:-fallback}`)

Later layers override earlier layers.

## 3. Inventory Structure

Top level:
- `version`
- `organization`
- `defaults`
- `instances[]`

`organization`:
- `org_id`, `org_slug`, `display_name`
- `deployment.provider` (`docker` or `kubernetes`)
- `deployment.kubernetes.namespace|context|kubeconfig` (optional defaults)

`defaults`:
- `port_stride`
- `policy.integrations`
- `policy.skills`
- `policy.models`

`instances[]`:
- `id`, `enabled`, `profile`
- `host`, `paths`
- `openclaw.config_layers`, `openclaw.docker`, `openclaw.kubernetes`
- `policy`
- `channels`
- `agents`

Kubernetes naming defaults (when omitted):
- `openclaw.kubernetes.deployment_name`: `oco-<instance-id>`
- `openclaw.kubernetes.service_name`: `oco-<instance-id>`
- `openclaw.kubernetes.container_name`: `oco-<instance-id>`

## 4. Agent and Binding Rules
Each agent supports:
- `id`, `role`, `workspace`, `agent_dir`
- `model`
- `integrations`, `skills`, `skill_sources`
- `bindings`

Example binding:
```yaml
bindings:
  - match:
      channel: telegram
      accountId: owner
```

Validation prevents duplicate `channel:accountId` bindings within the same instance.

Naming guidance:
- agent `id`: lowercase slug (`owner`, `research_ops`)
- account `accountId`: lowercase snake_case (`owner`, `research_ops`)
- optional display `name`: Title Case (`Research Ops`)

## 5. Policy Precedence
Effective policy order:
1. `defaults.policy`
2. `instances[].policy`
3. agent-declared requirements (`model`, `integrations`, `skills`)

Useful commands:
```bash
oco policy validate
oco policy effective --instance <id>
oco policy effective --instance <id> --agent-id <agent-id>
```

## 6. Environment Variables
Common variables:
- `OPENCLAW_GATEWAY_TOKEN`
- provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`)
- channel keys (`TELEGRAM_BOT_TOKEN*`, `DISCORD_BOT_TOKEN*`)
- action keys (`GITHUB_TOKEN`, `NOTION_API_KEY`, `BETTERSTACK_API_TOKEN`, `BETTERSTACK_API_BASE_URL`, `BRAVE_API_KEY`)
- CLI path overrides (`OCO_INVENTORY_PATH`, `OCO_SOUL_TEMPLATES_DIR`, `OCO_TOOLS_TEMPLATES_DIR`)
- deployment overrides (`OCO_DEPLOYMENT_PROVIDER`, `OCO_KUBE_CONTEXT`, `OCO_KUBE_NAMESPACE`, `OCO_KUBECONFIG`)

Example JSON5 env reference:
```json5
{
  gateway: {
    auth: {
      token: "${OPENCLAW_GATEWAY_TOKEN}",
    },
  },
}
```

## 7. Runtime Manifest Generation
`oco runtime generate --instance <id>` (or `oco compose generate --instance <id>`) creates provider-specific runtime manifests:
- Docker provider: `.generated/<instance-id>/docker-compose.yaml`
- Kubernetes provider: `.generated/<instance-id>/kubernetes.yaml`

Both include:
- OpenClaw runtime path envs
- passthrough provider/integration env vars when present
- rendered config handoff to runtime

## 8. Safety Rules
Do not commit:
- `.env` files
- rendered `instances/*/config/openclaw.json5*`
- `instances/*/state/**`
- `instances/*/workspaces/**`

Recommended pre-push checks:
```bash
git status
rg -n "sk-proj-|botToken\":\"|BEGIN PRIVATE KEY|OPENAI_API_KEY=" . --glob '!node_modules/**' --glob '!.git/**'
```

## 9. Validation and Deployment Flow
```bash
oco inventory init

set -a
source .env
set +a

oco validate
oco policy validate
oco preflight --instance core-human
oco render --instance core-human
oco runtime generate --instance core-human
oco runtime up --instance core-human
oco health --instance core-human
```

## 10. Template Workflows
Apply SOUL template:
```bash
oco soul list
oco soul apply --instance <instance-id> --agent-id <agent-id> --template <template-name>
```

Apply TOOLS template:
```bash
oco tools list
oco tools apply --instance <instance-id> --agent-id <agent-id> --template <template-name>
```

For isolation guidance across functional agents, see `docs/E2E_OCO_DISCORD_FUNCTIONAL_AGENTS.md`.
