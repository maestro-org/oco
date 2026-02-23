# E2E Example: Telegram Multi-Agent Setup

This guide shows a complete Telegram deployment flow for a single instance with per-account routing.

## 1. Prerequisites
- Docker + Docker Compose
- `oco` in PATH
- Telegram bots created in `@BotFather`

## 2. Initialize Local Inventory
```bash
oco inventory init
```

Edit `inventory/instances.local.yaml` with a structure like:

```yaml
version: 1
organization:
  org_id: acme
  org_slug: acme
  display_name: Acme

defaults:
  port_stride: 20
  policy:
    integrations:
      allow: [telegram]
      deny: []

instances:
  - id: core-human
    enabled: true
    profile: human
    host:
      bind: 127.0.0.1
      gateway_port: 19789
    paths:
      config_dir: ../instances/core-human/config
      state_dir: ../instances/core-human/state
      workspace_root: ../instances/core-human/workspaces
      generated_dir: ../.generated/core-human
    openclaw:
      config_layers:
        - ../templates/openclaw/org.base.json5
        - ../templates/openclaw/profiles/human.base.json5
        - ../instances/core-human/config/instance.overrides.json5
      docker:
        image: ghcr.io/openclaw/openclaw:latest
        container_name: openclaw-core-human
        restart: unless-stopped
    channels:
      telegram:
        accounts:
          owner: {}
          research: {}
    agents:
      - id: owner
        role: human
        workspace: owner
        agent_dir: agents/owner
        model: openai/gpt-5.1
        integrations: [telegram]
        bindings:
          - match:
              channel: telegram
              accountId: owner
      - id: research
        role: usecase
        workspace: research
        agent_dir: agents/research
        model: openai/gpt-5.1
        integrations: [telegram]
        bindings:
          - match:
              channel: telegram
              accountId: research
```

## 3. Configure Telegram Tokens
Create local override:

```bash
cp instances/core-human/config/instance.overrides.example.json5 \
  instances/core-human/config/instance.overrides.json5
```

Set account tokens:

```json5
{
  channels: {
    telegram: {
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      accounts: {
        owner: {
          botToken: "${TELEGRAM_BOT_TOKEN_OWNER}",
        },
        research: {
          botToken: "${TELEGRAM_BOT_TOKEN_RESEARCH}",
        },
      },
    },
  },
}
```

## 4. Configure Env
```bash
cp .env.example .env
```

Set values:

```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<provider-key>
TELEGRAM_BOT_TOKEN_OWNER=<token>
TELEGRAM_BOT_TOKEN_RESEARCH=<token>
```

Load:

```bash
set -a
source .env
set +a
```

## 5. Validate and Deploy
```bash
oco validate
oco policy validate
oco preflight --instance core-human
oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

## 6. Approve Pairings
In Telegram, DM each bot and send `/start`, then approve:

```bash
oco pairing list --instance core-human --channel telegram --account owner --json
oco pairing list --instance core-human --channel telegram --account research --json

oco pairing approve --instance core-human --channel telegram --account owner --code <PAIRING_CODE>
oco pairing approve --instance core-human --channel telegram --account research --code <PAIRING_CODE>
```

## 7. Smoke Test
- DM each bot and verify response maps to the intended agent.
- Verify policy and health:

```bash
oco health --instance core-human
oco policy effective --instance core-human --agent-id owner
oco policy effective --instance core-human --agent-id research
```
