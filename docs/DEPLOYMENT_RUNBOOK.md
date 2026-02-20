# Deployment Runbook

This runbook is for deploying `oco` against your own organization.

## 1. Prerequisites
- Node `25.6.1`
- Bun `1.3.9`
- Docker + Docker Compose

## 2. Install and build
```bash
bun install
bun run build
bun run install:global
oco --help
```

If `oco` is not found:
```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
hash -r
oco --help
```

## 3. Initialize and configure organization inventory
Create a local inventory from the tracked template:
```bash
oco inventory init
```

Then edit `inventory/instances.local.yaml`:
- `organization.org_id`
- `organization.org_slug`
- `organization.display_name`
- gateway `instances[*].host.gateway_port`
- agent/account bindings under `instances[*].agents[*].bindings`
- policy allowlists (`defaults.policy`, instance `policy`)

Notes:
- `inventory/instances.local.yaml` is ignored by git.
- `oco` auto-selects `inventory/instances.local.yaml` when present.
- Override path with `--inventory <path>` or `OCO_INVENTORY_PATH`.

## 4. Configure secrets
```bash
cp .env.example .env
```
Set at least:
- `OPENCLAW_GATEWAY_TOKEN`

For channel bot provisioning and token wiring details, see `docs/BOT_ACCESS_SETUP.md`.

Export env before deploy:
```bash
set -a
source .env
set +a
```

## 5. Validate before deploy
```bash
oco validate
oco policy validate
oco preflight --instance core-human
```

## 6. Deploy an instance
Use the helper script:
```bash
./scripts/deploy-instance.sh core-human
```

Or manual:
```bash
oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

For the Maestro Discord functional rollout:
```bash
./scripts/deploy-instance.sh maestro-discord-knowledge
./scripts/deploy-instance.sh maestro-discord-systems
./scripts/deploy-instance.sh maestro-discord-infra
```

## 7. Add an agent
```bash
./scripts/add-agent.sh core-human procurement usecase telegram:procurement openai/gpt-4.1-mini
```

Equivalent manual command:
```bash
oco agent add \
  --instance core-human \
  --agent-id procurement \
  --role usecase \
  --account telegram:procurement \
  --integration telegram \
  --model openai/gpt-4.1-mini
oco compose restart --instance core-human
```

Apply a SOUL template (existing agent):
```bash
oco soul list
oco soul apply --instance core-human --agent-id procurement --template operations
```

Or apply during add:
```bash
oco agent add ... --soul-template operations
```

Apply a TOOLS template (existing agent):
```bash
oco tools list
oco tools apply --instance core-human --agent-id procurement --template operations
```

Or apply during add:
```bash
oco agent add ... --tools-template operations
```

## 8. Smoke test checklist
- `oco health --instance <instance-id>` returns `running`
- `oco agent list --instance <instance-id>` shows expected agent(s)
- `oco pairing list --instance <instance-id> --channel telegram --account <account> --json` shows expected pairing requests
- Send a real message through the configured channel account
- Verify response is from the intended agent/account binding

Discord-specific checks:
- Each Discord bot has access only to its intended channel.
- `oco policy effective --instance <instance-id> --agent-id <agent-id>` shows only intended ingress integrations.
- Tool/API credentials are scoped per instance boundary (`knowledge`, `systems`, `infra`).

## 9. Update and rollback
```bash
oco deploy update --instance core-human --image-tag <tag>
oco deploy revisions --instance core-human
oco deploy rollback --instance core-human --revision <revision-id>
```
