# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Required Credentials

- `BETTERSTACK_API_TOKEN`
- `BETTERSTACK_API_BASE_URL`
- `GITHUB_TOKEN` for infra repo analysis and PR drafting

## Better Stack Connectivity

```bash
curl -sS "$BETTERSTACK_API_BASE_URL" -H "Authorization: Bearer $BETTERSTACK_API_TOKEN" -H "Content-Type: application/json"
```

## Triage Workflow

1. Capture current alerts/incidents from Better Stack.
2. Summarize impact, scope, and likely blast radius.
3. Correlate timing with deploys/config changes in infra repos.
4. Propose immediate mitigation and durable fix options.
5. Produce owner + ETA + rollback plan.

## Infra Repo Workflow

- Read repo state:

```bash
curl -sS "https://api.github.com/repos/<OWNER>/<REPO>/commits?per_page=20" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

- Draft follow-up issue:

```bash
curl -sS -X POST "https://api.github.com/repos/<OWNER>/<REPO>/issues" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" -d '{"title":"<INCIDENT FOLLOW-UP>","body":"<ROOT CAUSE + ACTIONS>"}'
```

## Guardrails

- Do not execute production changes without explicit approval.
- Prefer proposing PRs/runbooks over ad-hoc shell instructions.
- Explicitly label findings as fact, hypothesis, or unknown.
