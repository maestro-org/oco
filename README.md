# OpenClaw Orchestrator

<p align="center">
  <img src="media/logo.png" alt="oco logo" width="400" />
</p>

<p align="center">
  <a href="https://github.com/maestro-org/oco/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/maestro-org/oco/ci.yml?label=CI&logo=github&style=for-the-badge" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@maestro-org/oco"><img src="https://img.shields.io/npm/v/%40maestro-org%2Foco?label=npm&logo=npm&style=for-the-badge" alt="npm" /></a>
  <a href="https://codecov.io/gh/maestro-org/oco"><img src="https://img.shields.io/codecov/c/github/maestro-org/oco?label=codecov&logo=codecov&style=for-the-badge" alt="Codecov" /></a>
  <a href="https://discord.gg/SJgkEje7"><img src="https://img.shields.io/badge/discord-join%20server-5865F2?logo=discord&style=for-the-badge" alt="Discord" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/maestro-org/oco?label=license&style=for-the-badge" alt="License" /></a>
</p>

Manage OpenClaw organizations with inventory-driven configuration, isolated runtime boundaries, and repeatable deployment workflows.

## Features
- Multi-instance orchestration from a single inventory.
- Strict isolation across config/state/workspaces per instance.
- Org-level deployment provider selection (`docker` or `kubernetes`) with env overrides.
- Policy guardrails for models, skills, and integrations.
- Agent lifecycle commands (add/remove/list) with channel bindings.
- Template workflows for `SOUL.md` and `TOOLS.md`.
- Render/runtime/deploy workflows with revision support.

## Integrations
- Channels: Telegram, Discord.
- Tool/API workflows: GitHub, Notion, Better Stack, web search (Brave).

See `docs/INTEGRATIONS_AND_USE_CASES.md` for details.

## Quick Start

### 1. Install
Global install (recommended):
```bash
npm install -g @maestro-org/oco
oco --help
```

Run without installing globally:
```bash
npx @maestro-org/oco --help
```

If `oco` is not found:
```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
```

### 2. Initialize Inventory
```bash
oco inventory init
# or: npx @maestro-org/oco inventory init
```

Edit `inventory/instances.local.yaml` (recommended) for:
- organization metadata
- organization deployment target (`organization.deployment.provider`)
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

### 4. Choose Deployment Target
Set the org default in inventory:
```yaml
organization:
  deployment:
    provider: docker # or kubernetes
    kubernetes:
      namespace: default
      # context omitted => current kubectl context
```

When Kubernetes names are omitted, `oco` defaults deployment/service/container names to `oco-<instance-id>`.

Optional env overrides:
- `OCO_DEPLOYMENT_PROVIDER=docker|kubernetes`
- `OCO_KUBE_CONTEXT=<context>`
- `OCO_KUBE_NAMESPACE=<namespace>`
- `OCO_KUBECONFIG=<path>`

Inspect the resolved target:
```bash
oco deployment target --instance core-human
```

### 5. Validate and Deploy
```bash
oco validate
oco policy validate
oco preflight --instance core-human

./scripts/deploy-instance.sh core-human
oco health --instance core-human
```

`oco compose ...` and `oco runtime ...` are provider-aware and automatically use Docker Compose or Kubernetes based on org config/env.

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
./scripts/org.sh <org> runtime up --instance <instance-id>
./scripts/org.sh <org> health --instance <instance-id>
```

## CI/CD
- CI workflow (`.github/workflows/ci.yml`) runs typecheck, build, unit/integration tests, coverage generation, and dependency audit on push/PR.
- Security workflow (`.github/workflows/codeql.yml`) runs GitHub CodeQL analysis on push/PR and weekly schedule.
- Release workflow (`.github/workflows/release.yml`) publishes to npm when a GitHub Release is published.
- Required secret for release: `NPM_TOKEN` (npm automation token with publish scope).
- Optional secret for external coverage service uploads: `CODECOV_TOKEN`.
- Setup details: `docs/CI_CD.md`.

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
