# Configuration Details

This document explains how `oco` configuration is structured, merged, and applied.

## 1. Source of Truth
- `inventory/instances.example.yaml`: tracked reference template.
- `inventory/instances.local.yaml`: local inventory (recommended, gitignored).
- `inventory/instances.yaml`: fallback inventory path.
- `templates/openclaw/*.json5`: reusable baseline layers.
- `instances/<id>/config/instance.overrides.example.json5`: tracked example overrides.
- `instances/<id>/config/instance.overrides.json5`: local org-specific overrides (gitignored).

Inventory path resolution order:
1. `--inventory <path>`
2. `OCO_INVENTORY_PATH`
3. `inventory/instances.local.yaml` (if present)
4. `inventory/instances.yaml`

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

Safety default in the shared template:
- `agents.defaults.contextPruning.mode` is set to `off` to keep OpenAI Responses reasoning/tool chains intact during replay.
- If you re-enable pruning, validate multi-turn tool conversations first (especially on GPT-5 class models).

One-time recovery for already-broken sessions:
- If a session is already failing with `Item 'rs_...' ... required following item`, start a fresh session id for that conversation.
- In self-hosted state, remove the stale `sessionId` mapping from `instances/<id>/state/agents/<agent>/sessions/sessions.json` so the next inbound message creates a new session.

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
- `model`: model id, e.g. `openai/gpt-4.1-mini`.
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

Recommended naming convention:
- agent `id`: lowercase slug (`drichardson`, `saugustine`)
- Telegram account `accountId`: lowercase snake_case (`drichardson`, `scott_augustine`)
- Human display name: optional `name` field in Title Case (`Scott Augustine`)

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
- `BRAVE_API_KEY` (for `web_search`)
- channel-specific vars such as `TELEGRAM_BOT_TOKEN_*` and `DISCORD_BOT_TOKEN_*`
- tool-specific vars such as `GITHUB_TOKEN`, `NOTION_API_KEY`, and `BETTERSTACK_API_TOKEN`
- CLI path overrides such as `OCO_INVENTORY_PATH`, `OCO_SOUL_TEMPLATES_DIR`, and `OCO_TOOLS_TEMPLATES_DIR`

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
oco inventory init

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

## 11. SOUL Template Workflow
Use `templates/souls/*.md` for reusable agent personas:

```bash
oco soul list
oco soul apply --instance core-human --agent-id <agent-id> --template operations
```

For new agents:

```bash
oco agent add ... --soul-template operations
```

## 12. TOOLS Template Workflow
Use `templates/tools/*.md` for reusable `TOOLS.md` bootstrap content:

```bash
oco tools list
oco tools apply --instance core-human --agent-id <agent-id> --template operations
```

For new agents:

```bash
oco agent add ... --tools-template operations
```

## 13. Isolation Pattern for Functional Agents
For secure and efficient use-case deployment, group agents by credential risk and write-scope:

- Knowledge/research agents together (mostly read-heavy)
- System-of-record writers together (GitHub/Notion)
- Production triage agents isolated (monitoring + infra context)

This repo includes a concrete Discord example using this pattern:

- `maestro-discord-knowledge`
- `maestro-discord-systems`
- `maestro-discord-infra`

See `docs/E2E_OCO_DISCORD_MAESTRO.md` for full rollout and test steps.
