# oco: OpenClaw Orchestrator

<p align="left">
  <img src="media/logo.png" alt="oco logo" width="360" />
</p>

`oco` manages OpenClaw organizations with inventory-driven configuration, isolated runtime boundaries, and repeatable deployment workflows.

## Features
- Multi-instance orchestration from a single inventory.
- Strict isolation across config/state/workspaces per instance.
- Policy guardrails for models, skills, and integrations.
- Agent lifecycle commands (add/remove/list) with channel bindings.
- Template workflows for `SOUL.md` and `TOOLS.md`.
- Render/compose/deploy workflows with revision support.

## Integrations
- Channels: Telegram, Discord.
- Tool/API workflows: GitHub, Notion, Better Stack, web search (Brave).

See `docs/INTEGRATIONS_AND_USE_CASES.md` for details.

## Quick Start

### 1. Install
```bash
git clone https://github.com/<your-org>/oco.git
cd oco
bun install
bun run install:global
oco --help
```

If `oco` is not found:
```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
```

### 2. Initialize Inventory
```bash
oco inventory init
```

Edit `inventory/instances.local.yaml` (recommended) for:
- organization metadata
- instance ports and paths
- channel accounts + agent bindings
- policy allow/deny defaults

For isolated multi-org setups, use one inventory per org:
- `inventory/<org>.instances.local.yaml` (local, gitignored), or
- `inventory/<org>.instances.yaml` (tracked template/reference).

A generic multi-org example is available at `inventory/org.instances.example.yaml`.

Path resolution order:
1. `--inventory <path>`
2. `OCO_INVENTORY_PATH`
3. `inventory/instances.local.yaml`
4. `inventory/instances.yaml`

### 3. Configure Secrets
```bash
cp .env.example .env
```

Typical values:
```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<provider-key>

TELEGRAM_BOT_TOKEN_OWNER=<telegram-bot-token>
DISCORD_BOT_TOKEN_BRAIN_QA=<discord-bot-token>

GITHUB_TOKEN=<github-token>
NOTION_API_KEY=<notion-token>
BETTERSTACK_API_TOKEN=<betterstack-token>
BETTERSTACK_API_BASE_URL=<betterstack-api-base-url>
```

Load env:
```bash
set -a
source .env
set +a
```

For multi-org isolation, keep secrets in separate files (for example `.env.acme`, `.env.beta-org`) and load via:
```bash
ORG_ENV_FILE=.env.acme ./scripts/org.sh acme validate
```

### 4. Validate and Deploy
```bash
oco validate
oco policy validate
oco preflight --instance core-human

./scripts/deploy-instance.sh core-human
oco health --instance core-human
```

### 5. Manage Agents and Templates
```bash
oco agent list --instance core-human

oco agent add \
  --instance core-human \
  --agent-id support \
  --role usecase \
  --account telegram:support \
  --integration telegram \
  --model openai/gpt-5.1 \
  --soul-template operations \
  --tools-template operations
```

Apply templates to an existing agent:
```bash
oco soul apply --instance core-human --agent-id support --template operations --force
oco tools apply --instance core-human --agent-id support --template operations --force
```

Run org-scoped commands with the helper script:
```bash
./scripts/org.sh <org> validate
./scripts/org.sh <org> compose up --instance <instance-id>
./scripts/org.sh <org> health --instance <instance-id>
```

## Recommended Functional Isolation
Group by credential risk and write scope. For example:
- `discord-knowledge`: read-heavy QA/research agents.
- `discord-systems`: write-capable system-of-record agents (GitHub/Notion).
- `discord-infra`: monitoring + incident triage agents.

Detailed rollout: `docs/E2E_OCO_DISCORD_FUNCTIONAL_AGENTS.md`

## Documentation
Comprehensive documentation is available in `docs/`, including deployment steps, usage examples, and reusable templates.

## Security Best Practices
- Keep secrets in local `.env` only.
- Do not commit runtime state or rendered configs.
- Run before pushing:

```bash
git status --short --ignored
rg -n "sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY" .
```

## License
MIT (`LICENSE`)
