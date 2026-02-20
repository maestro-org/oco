# Integrations and Use Cases

This document lists the integrations currently configured or templated in this repo and the expected operating model.

## 1. Channel Integrations (Ingress)

| Integration | Classification | Current Repo Status | Typical Use Cases |
|---|---|---|---|
| Telegram | Core/built-in | Deployed E2E example and pairing runbook | Human-coupled assistants, direct operator workflows |
| Discord | Core/built-in | Maestro functional-agent inventory + runbook | Team channels for QA, ops, research, triage |

## 2. Tool/API Integrations (Agent Actions)

| Integration | Classification | Current Repo Status | Typical Use Cases | Required Credential |
|---|---|---|---|---|
| GitHub API | Tool/API | Template workflows for read + issue/PR actions | Repo QA, issue creation, PR orchestration | `GITHUB_TOKEN` |
| Notion API | Custom-only integration | Existing and new templates with direct API guardrails | Read/write docs, page summaries, knowledge updates | `NOTION_API_KEY` |
| Better Stack API | Custom tool/API | Infra triage template and runbook guidance | Alert triage, incident analysis, remediation planning | `BETTERSTACK_API_TOKEN` |
| Web search (Brave) | Tool/API | Existing env passthrough and config support | Research and documentation discovery | `BRAVE_API_KEY` |

## 3. Isolation Guidance

Recommended pattern for functional agents:

- Group by risk and credential boundary, not by pure topic similarity.
- Keep write-capable systems (`GitHub`, `Notion`) separate from broad research agents.
- Keep production triage (`Better Stack` + infra repos) isolated from general assistants.
- Keep one channel account identity per agent for deterministic routing.

For Maestro, the recommended deployment is:

- `maestro-discord-knowledge` (`brain-qa`, `deep-research`)
- `maestro-discord-systems` (`github-manager`, `notion-manager`)
- `maestro-discord-infra` (`infra-triage`)

## 4. Verification Levels

Use these levels when documenting rollout status:

- `config-validated`: inventory + policy + render/compose checks pass.
- `runtime-validated`: instance is healthy in `oco health`.
- `integration-smoke-tested`: real API actions succeeded with expected credentials.
- `production-ready`: least-privilege scopes, channel permissions, and runbooks reviewed.

## 5. References

- `docs/BOT_ACCESS_SETUP.md`
- `docs/E2E_OCO_TELEGRAM.md`
- `docs/E2E_OCO_DISCORD_MAESTRO.md`
- `docs/DATA_SOURCES_CONVENTION.md`
- `docs/CONFIGURATION_DETAILS.md`
- `docs/TOOLS_TEMPLATES.md`
