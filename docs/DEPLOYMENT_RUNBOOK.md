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

## 3. Configure organization inventory
Edit `inventory/instances.yaml`:
- `organization.org_id`
- `organization.org_slug`
- `organization.display_name`
- gateway `instances[*].host.gateway_port`
- agent/account bindings under `instances[*].agents[*].bindings`
- policy allowlists (`defaults.policy`, instance `policy`)

## 4. Configure secrets
```bash
cp .env.example .env
```
Set at least:
- `OPENCLAW_GATEWAY_TOKEN`

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

## 8. Smoke test checklist
- `oco health --instance <instance-id>` returns `running`
- `oco agent list --instance <instance-id>` shows expected agent(s)
- Send a real message through the configured channel account
- Verify response is from the intended agent/account binding

## 9. Update and rollback
```bash
oco deploy update --instance core-human --image-tag <tag>
oco deploy revisions --instance core-human
oco deploy rollback --instance core-human --revision <revision-id>
```
