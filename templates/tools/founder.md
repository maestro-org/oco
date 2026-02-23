# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Executive Workflow

1. Define the decision to be made and desired outcome.
2. Collect only decision-critical facts.
3. Present options with tradeoffs and a recommendation.
4. Assign owner, timeline, and follow-up checkpoint.

## Notion

- `NOTION_API_KEY` is expected to be preconfigured by operators.
- Validate connectivity when needed:

```bash
curl -sS https://api.notion.com/v1/users/me -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json"
```

## GitHub

- `GITHUB_TOKEN` should be available for repo/PR visibility.
- For high-impact repository actions, require explicit operator approval first.

## Change Safety

- No irreversible actions without explicit confirmation.
- Summaries should always include: decision, owner, due date, risk.
