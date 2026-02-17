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
- Inventory-driven instance/agent orchestration (`inventory/instances.yaml`).
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

## Deployment Example

### 1. Configure org inventory
Update `inventory/instances.yaml`.

Example:
```yaml
version: 1
organization:
  org_id: acme-org
  org_slug: acme-org
  display_name: Acme Organization

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
        model: openai/gpt-5-nano
        bindings:
          - match:
              channel: telegram
              accountId: Varderes
      - id: drichardson
        role: usecase
        workspace: drichardson
        agent_dir: agents/drichardson
        model: openai/gpt-5-nano
        bindings:
          - match:
              channel: telegram
              accountId: davis_rich
```

### 2. Configure secrets
```bash
cp .env.example .env
```

Set secrets in `.env` (example):
```dotenv
OPENCLAW_GATEWAY_TOKEN=<strong-random-token>
OPENAI_API_KEY=<openai-api-key>
TELEGRAM_BOT_TOKEN_VBARSEGYAN=<telegram-bot-token>
TELEGRAM_BOT_TOKEN_DRICHARDSON=<telegram-bot-token>
```

Reference those env vars in `instances/core-human/config/instance.overrides.json5`.

### 3. Deploy instance with direct `oco` commands
```bash
set -a
source .env
set +a

oco validate
oco policy validate
oco preflight --instance core-human

oco render --instance core-human
oco compose generate --instance core-human
oco compose up --instance core-human
oco health --instance core-human
```

### 4. Operate agents
```bash
oco agent list --instance core-human

oco agent add \
  --instance core-human \
  --agent-id support \
  --role usecase \
  --account telegram:support \
  --integration telegram \
  --model openai/gpt-5-nano

oco compose up --instance core-human
```

## Documentation
- Deployment runbook: `docs/DEPLOYMENT_RUNBOOK.md`
- End-to-end Telegram walkthrough: `docs/E2E_OCO_TELEGRAM.md`
- Configuration reference: `docs/CONFIGURATION_DETAILS.md`
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

## License
MIT (`LICENSE`)
