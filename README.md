# oco: OpenClaw orchestrator

<p align="left">
  <img src="media/logo.png" alt="oco logo" width="360" />
</p>

A tool for managing OpenClaw agent organizations

## Use Cases
- Human-coupled agents: each human gets a dedicated agent/account boundary.
- Functional agents: dedicated agents for support, procurement, growth, research, etc.
- Isolation-first operations: separate state/workspaces/ports across instances.
- Shared governance: org-wide defaults with per-instance and per-agent overrides.

## Features
- Inventory-driven instance/agent orchestration with template + local workflows.
- Validation for collisions and misconfiguration (ports, paths, bindings).
- Layered OpenClaw config rendering from templates + instance overrides.
- Docker Compose generation and lifecycle commands per instance.
- Agent add/remove/list operations.
- Policy checks for integrations, skills, and models.
- Revision snapshots for update/rollback workflows.

## Prerequisites
- Node.js `25+`
- Bun `1.3+`
- Docker + Docker Compose

## Install
```bash
git clone https://github.com/maestro-org/oco.git
cd oco
bun install
bun run install:global
oco --help
```

If `oco` is not found:
```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
```

## Quick Start

### 1. Create a local inventory (recommended)
Keep the tracked template for examples, and manage your real org config in an ignored file:
```bash
oco inventory init
```

This creates `inventory/instances.local.yaml` from the template.

Defaults:
- `oco` uses `inventory/instances.local.yaml` when it exists.
- Otherwise it falls back to `inventory/instances.yaml`.
- You can always override with `--inventory <path>` or `OCO_INVENTORY_PATH`.

### 2. Configure your organization inventory
Edit `inventory/instances.local.yaml` (or your chosen inventory path) for:
- `organization.org_id`, `organization.org_slug`, `organization.display_name`
- `instances[*].host.gateway_port`
- channel account mappings and `agents[*].bindings`
- policy allowlists under `defaults.policy` and `instances[*].policy`

Reference template:
- `inventory/instances.example.yaml`

### 3. Configure secrets
```bash
cp .env.example .env
```

Set required values in `.env`:
```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<provider-key>
TELEGRAM_BOT_TOKEN_VBARSEGYAN=<telegram-bot-token>
TELEGRAM_BOT_TOKEN_DRICHARDSON=<telegram-bot-token>
```

Load env:
```bash
set -a
source .env
set +a
```

### 4. Deploy
```bash
./scripts/deploy-instance.sh core-human
```

Manual equivalent:
```bash
oco validate
oco policy validate
oco render --instance core-human
oco compose generate --instance core-human
oco preflight --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

### 5. Pair Telegram users
```bash
oco pairing list --instance core-human --channel telegram --account drichardson --json
oco pairing approve --instance core-human --channel telegram --account drichardson --code <PAIRING_CODE>
```

### 6. Manage agents
```bash
oco agent list --instance core-human

oco agent add \
  --instance core-human \
  --agent-id support \
  --role usecase \
  --account telegram:support \
  --integration telegram \
  --model openai/gpt-4.1-mini \
  --soul-template operations \
  --tools-template operations

oco soul list
oco soul apply --instance core-human --agent-id drichardson --template business-development --force
oco tools list
oco tools apply --instance core-human --agent-id drichardson --template business-development --force

oco compose up --instance core-human
```

## Documentation
- Deployment runbook: `docs/DEPLOYMENT_RUNBOOK.md`
- End-to-end Telegram walkthrough: `docs/E2E_OCO_TELEGRAM.md`
- Configuration reference: `docs/CONFIGURATION_DETAILS.md`
- SOUL template workflow: `docs/SOUL_TEMPLATES.md`
- TOOLS template workflow: `docs/TOOLS_TEMPLATES.md`
- Product requirements: `docs/REQUIREMENTS.md`

## Open Source Safety
- Keep real secrets only in local `.env` (ignored by default).
- Do not commit runtime state or rendered configs from `instances/*/state` and `instances/*/config/openclaw.json5*`.
- Run this before pushing:

```bash
git status --short --ignored
rg -n "sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY" .
```

## TODO
- [ ] Dashboard UI
- [ ] Kubernetes deployments
- [ ] SSO OAuth support
- [ ] Model provider usage and analytics integration

## License
MIT (`LICENSE`)
