# Deployment Runbook

This runbook covers a standard `oco` deployment for any organization.

## 1. Prerequisites
- Node `25+`
- Bun `1.3+`
- Docker + Docker Compose

## 2. Install
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

## 3. Initialize Inventory
```bash
oco inventory init
```

Update `inventory/instances.local.yaml`:
- organization metadata
- instance ports and paths
- account bindings
- policy allowlists

Notes:
- `inventory/instances.local.yaml` is gitignored.
- `oco` auto-selects it when present.
- override with `--inventory <path>` or `OCO_INVENTORY_PATH`.

## 4. Configure Secrets
```bash
cp .env.example .env
```

Set at least:
- `OPENCLAW_GATEWAY_TOKEN`
- provider key(s) you plan to use
- channel/tool keys required by your agents

Load env:
```bash
set -a
source .env
set +a
```

## 5. Validate Before Deploy
```bash
oco validate
oco policy validate
oco preflight --instance core-human
```

## 6. Deploy
Helper script:
```bash
./scripts/deploy-instance.sh core-human
```

Manual equivalent:
```bash
oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

For multi-instance functional deployments, deploy each target instance:
```bash
./scripts/deploy-instance.sh <instance-id>
```

## 7. Agent Operations
Add an agent:
```bash
./scripts/add-agent.sh core-human procurement usecase telegram:procurement openai/gpt-4.1-mini
```

Manual equivalent:
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

Apply templates:
```bash
oco soul apply --instance core-human --agent-id procurement --template operations
oco tools apply --instance core-human --agent-id procurement --template operations
```

## 8. Smoke Test Checklist
- `oco health --instance <instance-id>` is `running`.
- `oco agent list --instance <instance-id>` shows expected agents.
- Pairing (if enabled) works for expected accounts.
- Real channel message reaches the intended bound agent.
- `oco policy effective --instance <instance-id> --agent-id <agent-id>` matches intended scope.

## 9. Update and Rollback
```bash
oco deploy update --instance core-human --image-tag <tag>
oco deploy revisions --instance core-human
oco deploy rollback --instance core-human --revision <revision-id>
```
