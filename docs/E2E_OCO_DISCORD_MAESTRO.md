# E2E Example: Maestro Discord Functional Agents

This guide rolls out five Discord-routed agents with a secure isolation model:

- `brain-qa` -> `#brain-qa`
- `github-manager` -> `#github-manager`
- `notion-manager` -> `#notion-manager`
- `infra-triage` -> `#infra-triage`
- `deep-research` -> `#deep-research`

For a concise provisioning checklist, see `docs/BOT_ACCESS_SETUP.md`.

## 1. Isolation Model (Recommended)

Use three instances grouped by risk domain:

- `maestro-discord-knowledge`
  - `brain-qa`, `deep-research`
  - mostly read-heavy research/knowledge tasks
- `maestro-discord-systems`
  - `github-manager`, `notion-manager`
  - write-capable systems of record (code/docs)
- `maestro-discord-infra`
  - `infra-triage`
  - production monitoring/incident context

Why this model:
- Better blast-radius control than one shared runtime.
- Lower operational overhead than five fully separate gateways.
- Clean credential boundaries per instance.

## 2. Inventory Is Already Included

This repo now includes those three instances in:

- `inventory/instances.yaml`
- `inventory/instances.example.yaml`

Important:
- If you run with `inventory/instances.local.yaml`, copy/merge these instance blocks there.
- Or pass `--inventory inventory/instances.yaml` (or `INVENTORY_PATH=inventory/instances.yaml`) in commands below.

With account mappings:
- `brain_qa`
- `deep_research`
- `github_manager`
- `notion_manager`
- `infra_triage`

## 3. Create Discord Bots (One Per Agent)

Create one Discord application+bot per account in Discord Developer Portal:

- `brain_qa`
- `deep_research`
- `github_manager`
- `notion_manager`
- `infra_triage`

Required bot permissions:
- View Channels
- Send Messages
- Read Message History
- Mention Everyone (optional, only if needed)

Invite each bot to the Maestro server (guild) with least privilege.

## 4. Create Discord Channels

Create channels manually in Discord server settings:

- `brain-qa`
- `github-manager`
- `notion-manager`
- `infra-triage`
- `deep-research`

Then restrict each bot to only its target channel and operator/admin roles.

## 5. Configure Overrides and Secrets

Copy per-instance override files if you want local (gitignored) variants:

```bash
cp instances/maestro-discord-knowledge/config/instance.overrides.example.json5 instances/maestro-discord-knowledge/config/instance.overrides.json5
cp instances/maestro-discord-systems/config/instance.overrides.example.json5 instances/maestro-discord-systems/config/instance.overrides.json5
cp instances/maestro-discord-infra/config/instance.overrides.example.json5 instances/maestro-discord-infra/config/instance.overrides.json5
```

If you use local override files, update `openclaw.config_layers` to point to `instance.overrides.json5`.

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
NOTION_API_KEY=<notion-internal-integration-token>
BETTERSTACK_API_TOKEN=<betterstack-token>
BETTERSTACK_API_BASE_URL=<betterstack-api-base-url>
```

Load env:

```bash
set -a
source .env
set +a
```

## 6. Apply SOUL/TOOLS Templates

```bash
oco --inventory inventory/instances.yaml soul apply --instance maestro-discord-knowledge --agent-id brain-qa --template brain-qa --force
oco --inventory inventory/instances.yaml tools apply --instance maestro-discord-knowledge --agent-id brain-qa --template brain-qa --force

oco --inventory inventory/instances.yaml soul apply --instance maestro-discord-knowledge --agent-id deep-research --template deep-research --force
oco --inventory inventory/instances.yaml tools apply --instance maestro-discord-knowledge --agent-id deep-research --template deep-research --force

oco --inventory inventory/instances.yaml soul apply --instance maestro-discord-systems --agent-id github-manager --template github-manager --force
oco --inventory inventory/instances.yaml tools apply --instance maestro-discord-systems --agent-id github-manager --template github-manager --force

oco --inventory inventory/instances.yaml soul apply --instance maestro-discord-systems --agent-id notion-manager --template notion-manager --force
oco --inventory inventory/instances.yaml tools apply --instance maestro-discord-systems --agent-id notion-manager --template notion-manager --force

oco --inventory inventory/instances.yaml soul apply --instance maestro-discord-infra --agent-id infra-triage --template infra-triage --force
oco --inventory inventory/instances.yaml tools apply --instance maestro-discord-infra --agent-id infra-triage --template infra-triage --force
```

## 7. Configure DATA_SOURCES Convention (Knowledge + Research)

Bootstrap:

```bash
cp templates/data-sources/knowledge.md instances/maestro-discord-knowledge/workspaces/brain-qa/DATA_SOURCES.md
cp templates/data-sources/knowledge.md instances/maestro-discord-knowledge/workspaces/deep-research/DATA_SOURCES.md
```

Then customize both files with your real repos/docs/internal sources.

## 8. Validate and Deploy

```bash
oco --inventory inventory/instances.yaml validate
oco --inventory inventory/instances.yaml policy validate

INVENTORY_PATH=inventory/instances.yaml ./scripts/deploy-instance.sh maestro-discord-knowledge
INVENTORY_PATH=inventory/instances.yaml ./scripts/deploy-instance.sh maestro-discord-systems
INVENTORY_PATH=inventory/instances.yaml ./scripts/deploy-instance.sh maestro-discord-infra
```

## 9. Smoke Tests

Health and inventory:

```bash
oco --inventory inventory/instances.yaml health --instance maestro-discord-knowledge
oco --inventory inventory/instances.yaml health --instance maestro-discord-systems
oco --inventory inventory/instances.yaml health --instance maestro-discord-infra

oco --inventory inventory/instances.yaml agent list --instance maestro-discord-knowledge
oco --inventory inventory/instances.yaml agent list --instance maestro-discord-systems
oco --inventory inventory/instances.yaml agent list --instance maestro-discord-infra
```

Discord channel tests:

- In `#brain-qa`: ask a company question tied to a known repo/doc.
- In `#github-manager`: request creating a draft issue in a test repo.
- In `#notion-manager`: request reading and then updating a test page.
- In `#infra-triage`: ask for current alerts and a mitigation plan.
- In `#deep-research`: request a multi-step analysis with explicit recommendations.

Expected result:
- Each channel responds only through its mapped agent identity.
- No cross-agent routing across `channel:accountId` boundaries.

## 10. Security Hardening Checklist

- Keep one bot token per account and rotate quarterly.
- Keep one credential boundary per instance (`knowledge`, `systems`, `infra`).
- Restrict GitHub token scopes to required repos/actions.
- Restrict Notion integration sharing to required pages/databases.
- Restrict Better Stack token to read-only when possible.
- Use per-instance policies to allow only `discord` ingress.
