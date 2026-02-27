# E2E Example: Discord Functional Agents

This guide deploys five Discord-routed agents with secure isolation:
- `brain-qa` -> `#brain-qa`
- `github-manager` -> `#github-manager`
- `notion-manager` -> `#notion-manager`
- `infra-triage` -> `#infra-triage`
- `deep-research` -> `#deep-research`

## 1. Isolation Model (Recommended)

Use three instances grouped by risk domain:
- `discord-knowledge`: `brain-qa`, `deep-research` (read-heavy)
- `discord-systems`: `github-manager`, `notion-manager` (write-capable)
- `discord-infra`: `infra-triage` (monitoring + incident context)

## 2. Configure Inventory

Add/adjust these instances in your inventory (`instances.local.yaml` recommended):
- `discord-knowledge`
- `discord-systems`
- `discord-infra`

Set org deployment target once (Docker or Kubernetes) under `organization.deployment.provider`. All runtime commands below automatically follow that setting.

You can keep these IDs or rename them. If renamed, update all commands below accordingly.

Use account IDs:
- `brain_qa`
- `deep_research`
- `github_manager`
- `notion_manager`
- `infra_triage`

## 3. Create Discord Bots

Create one Discord app+bot per account in Discord Developer Portal.

Required permissions:
- View Channels
- Send Messages
- Read Message History

Intents:
- Message Content Intent
- Server Members Intent (recommended)

## 4. Create Channels

Create channels:
- `brain-qa`
- `github-manager`
- `notion-manager`
- `infra-triage`
- `deep-research`

Restrict each bot to only its target channel and operator/admin roles.

## 5. Configure Overrides and Env

Create local override files as needed:

```bash
cp instances/<knowledge-instance-id>/config/instance.overrides.example.json5 instances/<knowledge-instance-id>/config/instance.overrides.json5
cp instances/<systems-instance-id>/config/instance.overrides.example.json5 instances/<systems-instance-id>/config/instance.overrides.json5
cp instances/<infra-instance-id>/config/instance.overrides.example.json5 instances/<infra-instance-id>/config/instance.overrides.json5
```

Set `.env` values:

```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<provider-key>

DISCORD_BOT_TOKEN_BRAIN_QA=<token>
DISCORD_BOT_TOKEN_DEEP_RESEARCH=<token>
DISCORD_BOT_TOKEN_GITHUB_MANAGER=<token>
DISCORD_BOT_TOKEN_NOTION_MANAGER=<token>
DISCORD_BOT_TOKEN_INFRA_TRIAGE=<token>

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

## 6. Apply Agent Templates

```bash
oco --inventory inventory/instances.local.yaml soul apply --instance discord-knowledge --agent-id brain-qa --template brain-qa --force
oco --inventory inventory/instances.local.yaml tools apply --instance discord-knowledge --agent-id brain-qa --template brain-qa --force

oco --inventory inventory/instances.local.yaml soul apply --instance discord-knowledge --agent-id deep-research --template deep-research --force
oco --inventory inventory/instances.local.yaml tools apply --instance discord-knowledge --agent-id deep-research --template deep-research --force

oco --inventory inventory/instances.local.yaml soul apply --instance discord-systems --agent-id github-manager --template github-manager --force
oco --inventory inventory/instances.local.yaml tools apply --instance discord-systems --agent-id github-manager --template github-manager --force

oco --inventory inventory/instances.local.yaml soul apply --instance discord-systems --agent-id notion-manager --template notion-manager --force
oco --inventory inventory/instances.local.yaml tools apply --instance discord-systems --agent-id notion-manager --template notion-manager --force

oco --inventory inventory/instances.local.yaml soul apply --instance discord-infra --agent-id infra-triage --template infra-triage --force
oco --inventory inventory/instances.local.yaml tools apply --instance discord-infra --agent-id infra-triage --template infra-triage --force
```

## 7. Bootstrap DATA_SOURCES (Knowledge)

```bash
cp templates/data-sources/knowledge.md instances/discord-knowledge/workspaces/brain-qa/DATA_SOURCES.md
cp templates/data-sources/knowledge.md instances/discord-knowledge/workspaces/deep-research/DATA_SOURCES.md
```

## 8. Validate and Deploy

```bash
oco --inventory inventory/instances.local.yaml validate
oco --inventory inventory/instances.local.yaml policy validate

./scripts/deploy-instance.sh discord-knowledge
./scripts/deploy-instance.sh discord-systems
./scripts/deploy-instance.sh discord-infra
```

## 9. Smoke Tests

```bash
oco --inventory inventory/instances.local.yaml health --instance discord-knowledge
oco --inventory inventory/instances.local.yaml health --instance discord-systems
oco --inventory inventory/instances.local.yaml health --instance discord-infra
```

Channel checks:
- `#brain-qa`: ask a question tied to known docs/repos.
- `#github-manager`: request issue or PR prep in a test repo.
- `#notion-manager`: request read + update on a test page.
- `#infra-triage`: request alert summary + mitigation steps.
- `#deep-research`: request a multi-step analysis with recommendations.

Expected:
- each channel responds via its mapped agent
- no cross-agent routing across `channel:accountId` mappings

## 10. Security Checklist

- one bot token per account
- one credential boundary per instance (`knowledge`, `systems`, `infra`)
- least-privilege scopes for GitHub/Notion/Better Stack
- channel allowlists + mention gating for guild traffic
