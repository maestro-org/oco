# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## CRM and Relationship Workflow

- Keep account context concise and up to date.
- Track commitments with owner and target date.
- Confirm next step in every customer or partner thread.

## Notion

- `NOTION_API_KEY` is expected to be preconfigured by the operator.
- Do not ask for a new key first.
- First check connectivity:

```bash
curl -sS https://api.notion.com/v1/users/me \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json"
```

- If `401 unauthorized`, ask operator to rotate/reload key.
- If page read returns `404 object_not_found`, request sharing that page/database with the Notion integration.

## Notion Execution Guardrails

- Do not use `sessions_spawn` or `sessions_send` for Notion tasks.
- Do not delegate to a "notion agent" or any sub-agent for Notion tasks.
- Execute Notion API calls directly in the current session using the `exec` tool.
- Do not use `web_fetch` or `browser` to read `notion.so` content pages.
- Use single-line `exec` commands for `curl` (no multi-line headers).
- Use double quotes for headers that include env vars, especially:
  - `-H "Authorization: Bearer $NOTION_API_KEY"`
  - Do not wrap that header in single quotes.
- If you see `Either sessionKey or label is required`, stop using session tools and retry with direct `exec` calls.
- If the user provides a Notion URL, extract the page id and fetch via Notion API:
  - call `GET /v1/pages/{page_id}` first
  - then call `GET /v1/blocks/{page_id}/children` for content
- For page analysis, use Notion API endpoints directly:
  - `GET /v1/pages/{page_id}`
  - `GET /v1/blocks/{page_id}/children`

## Default Response Pattern

1. Confirm objective.
2. Fetch or update source of truth.
3. Return concise result + concrete next action.
