# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Required Credentials

- `GITHUB_TOKEN` with least-privilege scopes for your org/repos.

## Connectivity Check

```bash
curl -sS https://api.github.com/user -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

## Core Workflows

- Read repo state:

```bash
curl -sS "https://api.github.com/orgs/<ORG>/repos?per_page=100" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

- Create issue:

```bash
curl -sS -X POST "https://api.github.com/repos/<OWNER>/<REPO>/issues" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" -d '{"title":"<TITLE>","body":"<BODY>"}'
```

- Create pull request:

```bash
curl -sS -X POST "https://api.github.com/repos/<OWNER>/<REPO>/pulls" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" -d '{"title":"<TITLE>","head":"<HEAD_BRANCH>","base":"<BASE_BRANCH>","body":"<BODY>"}'
```

## Change-Safety Rules

- For write operations, present a short action plan first, then execute.
- For high-impact operations (merge/close/reopen/label sweep), request explicit approval.
- Never force-push or delete protected branches.

## Default Response Pattern

1. Current repo context.
2. Proposed action.
3. Execution result with links/ids.
4. Next recommended step.
