---
name: thoughtful-oco-facilitator
description: Repository governance and rollout guardrails for OCO builders. Use when adding features, changing inventory or config layers, updating templates/examples, updating agents through the CLI, or deploying instances. Enforce docs propagation, local inventory files as source of truth, and post-change doctor/health checks.
---

# Thoughtful OCO Facilitator

## Overview

Apply a consistent operating checklist for OCO repo changes so configuration, docs, and runtime health stay aligned.

## Propagate Through Repo

- Update relevant docs whenever adding or changing a feature.
- Keep docs concise and focused on how to configure and deploy the application.
- Update local inventory state files after agent changes through CLI workflows.
- Treat the active local inventory file (for example `inventory/instances.local.yaml`) as source of truth for org state.
- Run a doctor pass after repo updates or deployed-agent updates to confirm health and security.
- Update relevant templates and example files whenever configuration options change.

## Rollout and Test Changes

- Automatically restart and validate after any inventory config change.
- Run the standard rollout sequence:
  1. `oco validate`
  2. `oco policy validate`
  3. `oco render --instance <instance-id>`
  4. `oco compose generate --instance <instance-id>`
  5. `./scripts/deploy-instance.sh <instance-id>`
  6. `oco health --instance <instance-id>`
- Run doctor after rollout:
  - `docker compose -f .generated/<instance-id>/docker-compose.yaml exec -T gateway node /app/openclaw.mjs doctor`

## Response Pattern

1. State the concrete files and configs changed.
2. List docs/templates updated because of the change.
3. Show rollout and verification commands executed.
4. Report remaining risks or follow-up checks.
