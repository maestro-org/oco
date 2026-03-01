---
name: thoughtful-oco-facilitator
description: Repository governance and rollout guardrails for OCO builders. Use when adding features, changing inventory or config layers, updating templates/examples, updating agents through the CLI, or deploying instances. Enforce docs propagation, local inventory files as source of truth, and post-change doctor/health checks.
---

# Thoughtful OCO Facilitator

## Overview

Apply a consistent operating checklist for OCO repo changes so configuration, docs, and runtime health stay aligned. Continuously improve this skill with new best practices and checklist items as we learn from real world usage and changes. The goal is to maintain a high standard of quality, security, and reliability for all OCO builders while making the process of contributing and deploying as smooth as possible.

## Propagate Through Repo

- Update relevant docs whenever adding or changing a feature.
- Keep docs concise and focused on how to configure and deploy the application.
- Update local inventory state files after agent changes through CLI workflows.
- Treat the active local inventory file (for example `inventory/instances.local.yaml`) as source of truth for org state.
- Run a doctor pass after repo updates or deployed-agent updates to confirm health and security.
- Update relevant templates and example files whenever configuration options change.
- Anytime we need to run a new custom command or script to add a feature or monitor an agent, if it's generalizable, add it to the CLI and document it in the README. The CLI should be the primary interface for interacting with the repo, and custom scripts should be added to the CLI if they are generally useful for managing agents or instances.

## Rollout Agent Changes With Care

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
- Make sure all stale, outdated or erroneous sessions are cleared after rollout and agent updates. Check all active sessions.
- Make sure any configuration updates to agents, such as models, are reflected in the local inventory files and properly rolled out.
- Your end to end tests should ensure that changes are rolled out and working properly.

## Response Pattern

1. State the concrete files and configs changed.
2. List docs/templates updated because of the change.
3. Show rollout and verification commands executed.
4. Report remaining risks or follow-up checks.

## Security Is a Top Priority

- Users of bots should not be able configure the following
  - Models
  - Environment variables
- Never commit any sensitive information to the repo, including API keys, secrets, or personally identifiable information. Use environment variables or secure vaults to manage sensitive data.

## CI Updates And Testing

- New features or changes should include updates to CI workflows to ensure that the new code is properly tested and validated before being merged. This includes adding new test cases, updating existing tests, and ensuring that all tests pass successfully.

## Useful References

- Refer to OpenClaw docs for features, configuration options, best practices and security guidelines: https://docs.openclaw.ai/