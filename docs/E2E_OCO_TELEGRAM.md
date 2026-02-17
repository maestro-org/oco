# E2E Example: Org Setup + Telegram Agents

This guide shows a full example to:
1. Configure an organization in a local inventory
2. Configure Telegram bot accounts and per-agent routing
3. Approve Telegram pairings and run a smoke test

## 1. Prerequisites
- Docker + Docker Compose
- `oco` installed and available in PATH
- OpenClaw image pull access (`ghcr.io/openclaw/openclaw:latest`)
- Telegram bots created via `@BotFather` (one bot per agent account)

Check CLI:
```bash
oco --help
```

If `oco` is not in PATH, use the local binary for this repo:
```bash
./scripts/oco.sh --help
```

## 2. Initialize and Configure Org + Instance + Agent Routing
Create a local inventory from the tracked template:
```bash
oco inventory init
```

Then edit `inventory/instances.local.yaml`.

Use this as a working example:

```yaml
version: 1
organization:
  org_id: maestro
  org_slug: maestro
  display_name: Maestro

defaults:
  port_stride: 20
  policy:
    integrations:
      allow: [telegram]
      deny: []
    skills:
      allow: []
      deny: []
      allow_sources: [bundled, managed, workspace]
      deny_sources: []
    models:
      allow_providers: [openai, anthropic, openrouter, litellm, ollama]
      deny_providers: []
      allow_models: []
      deny_models: []

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
    policy:
      integrations:
        allow: [telegram]
      models:
        allow_providers: [openai, anthropic]
    channels:
      telegram:
        accounts:
          vbarsegyan: {}
          drichardson: {}
    agents:
      - id: vbarsegyan
        role: human
        workspace: vbarsegyan
        agent_dir: agents/vbarsegyan
        model: openai/gpt-4.1-mini
        integrations:
          - telegram
        skills:
          - github
          - coding-agent
        skill_sources:
          - bundled
        bindings:
          - match:
              channel: telegram
              accountId: vbarsegyan
      - id: drichardson
        role: human
        workspace: drichardson
        agent_dir: agents/drichardson
        model: openai/gpt-4.1-mini
        integrations:
          - telegram
        skills:
          - github
        skill_sources:
          - bundled
        bindings:
          - match:
              channel: telegram
              accountId: drichardson
```

## 3. Configure Telegram Tokens in Config Layer
Edit `instances/core-human/config/instance.overrides.json5`.

```json5
{
  channels: {
    telegram: {
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      accounts: {
        vbarsegyan: {
          botToken: "${TELEGRAM_BOT_TOKEN_VBARSEGYAN}",
        },
        drichardson: {
          botToken: "${TELEGRAM_BOT_TOKEN_DRICHARDSON}",
        }
      },
    },
  },
}
```

Why this matters:
- You are using multi-account routing (`vbarsegyan`, `drichardson`), so each account should have its own bot token.
- `TELEGRAM_BOT_TOKEN` env fallback is only for the default account, not your named multi-account setup.

## 4. Configure Secrets
Create `.env`:

```bash
cp .env.example .env
```

Set:
```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<provider-key>
TELEGRAM_BOT_TOKEN_VBARSEGYAN=<token-from-botfather>
TELEGRAM_BOT_TOKEN_DRICHARDSON=<token-from-botfather>
```

Load env for the current shell:
```bash
set -a
source .env
set +a
```

## 5. Validate and Deploy
Run from repo root:

```bash
oco validate
oco policy validate
oco preflight --instance core-human

oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

Expected health:
- `status` should be `running`

## 6. Verify Agent Inventory and Runtime
```bash
oco agent list --instance core-human
oco compose ps --instance core-human
```

Optional logs:
```bash
oco compose logs --instance core-human
```

## 7. Connect Telegram Users to Each Agent (Pairing)
With `dmPolicy: pairing`, Telegram DMs require approval.

1. In Telegram, DM each bot and send `/start`.
2. List pending requests for each account:

```bash
oco pairing list --instance core-human --channel telegram --account vbarsegyan --json
oco pairing list --instance core-human --channel telegram --account drichardson --json
```

3. Approve each pairing code:

```bash
oco pairing approve --instance core-human --channel telegram --account vbarsegyan --code <PAIRING_CODE>
oco pairing approve --instance core-human --channel telegram --account drichardson --code <PAIRING_CODE>
```

## 8. Smoke Test Routing
- Send a DM to the `vbarsegyan` bot and verify it responds as `vbarsegyan`.
- Send a DM to the `drichardson` bot and verify it responds as `drichardson`.
- Re-check:

```bash
oco health --instance core-human
oco policy effective --instance core-human --agent-id vbarsegyan
oco policy effective --instance core-human --agent-id drichardson
```

## 9. Add or Remove Agents
Add a new Telegram-routed agent:

```bash
oco agent add \
  --instance core-human \
  --agent-id support \
  --role usecase \
  --account telegram:support \
  --integration telegram \
  --model openai/gpt-4.1-mini
```

Then add a token entry for `support` in `instances/core-human/config/instance.overrides.json5`, add `TELEGRAM_BOT_TOKEN_SUPPORT` to `.env`, and apply changes:

```bash
set -a
source .env
set +a
oco compose up --instance core-human
oco agent list --instance core-human
```

Remove an agent:

```bash
oco agent remove --instance core-human --agent-id support
oco compose up --instance core-human
```

## 10. References
- Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- Pairing CLI docs: https://docs.openclaw.ai/cli/pairing
- Configuration reference (`channels`, `bindings`, multi-account): https://docs.openclaw.ai/gateway/configuration-reference
