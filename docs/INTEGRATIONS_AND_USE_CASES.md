# Integrations and Use Cases

This document summarizes supported integration surfaces and where each fits in a production setup.

## 1. Channel Integrations (Ingress)

| Integration | Type | Typical Use Cases |
|---|---|---|
| Telegram | Core channel | Human-coupled assistants, DM-first workflows, lightweight ops routing |
| Discord | Core channel | Team channels, functional agents, cross-team QA/research/triage |

## 2. Tool/API Integrations (Agent Actions)

| Integration | Type | Typical Use Cases | Required Credential |
|---|---|---|---|
| GitHub API | Tool/API | Repository analysis, issue creation, PR workflows | `GITHUB_TOKEN` |
| Notion API | Tool/API | Read/write docs, page updates, internal knowledge operations | `NOTION_API_KEY` |
| Better Stack API | Tool/API | Alert triage, incident analysis, remediation planning | `BETTERSTACK_API_TOKEN` |
| Brave Search API | Tool/API | Research and source discovery | `BRAVE_API_KEY` |

## 3. Isolation Pattern (Recommended)

Group agents by credential risk and write scope:
- `knowledge` instance: read-heavy QA/research.
- `systems` instance: write-capable system-of-record actions (GitHub, Notion).
- `infra` instance: monitoring + incident triage.

Why:
- Limits blast radius.
- Reduces accidental cross-domain tool access.
- Keeps access boundaries auditable.

## 4. Rollout Verification Levels

Use these levels to track rollout quality:
- `config-validated`: inventory, policy, render/compose checks pass.
- `runtime-validated`: `oco health` reports running status.
- `integration-smoke-tested`: real API actions succeed with expected scope.
- `production-ready`: least privilege, credential review, and runbook sign-off complete.

## 5. References

- `docs/CONFIGURATION_DETAILS.md`
- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/BOT_ACCESS_SETUP.md`
- `docs/E2E_OCO_TELEGRAM.md`
- `docs/E2E_OCO_DISCORD_FUNCTIONAL_AGENTS.md`
- `docs/DATA_SOURCES_CONVENTION.md`
