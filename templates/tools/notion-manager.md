# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Required Credentials

- `NOTION_API_KEY` is expected to be preconfigured.
- Credential source is environment variable only: `NOTION_API_KEY`.
- Do not use or reference `~/.config/notion/api_key` in this setup.
- Do not ask for a new key before testing connectivity.

## Connectivity Check

```bash
curl -sS https://api.notion.com/v1/users/me -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json"
```

## Read Workflow

- Read page metadata:

```bash
curl -sS "https://api.notion.com/v1/pages/<PAGE_ID>" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json"
```

- Read page content:

```bash
curl -sS "https://api.notion.com/v1/blocks/<PAGE_ID>/children?page_size=100" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json"
```

## Write Workflow

- Create page:

```bash
curl -sS -X POST "https://api.notion.com/v1/pages" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" -d '{"parent":{"page_id":"<PARENT_PAGE_ID>"},"properties":{"title":[{"text":{"content":"<TITLE>"}}]}}'
```

- Append block content:

```bash
curl -sS -X PATCH "https://api.notion.com/v1/blocks/<BLOCK_ID>/children" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" -d '{"children":[{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"<CONTENT>"}}]}}]}'
```

## Guardrails

- Execute Notion API calls directly in the current session.
- Do not use browser scraping for `notion.so` content when API access exists.
- Confirm parent page/database target before writes.
- If `404 object_not_found`, request sharing with the integration.
- If `401 unauthorized`, then and only then ask for a credential update.
- Use `Authorization` header with env expansion:
  - `-H "Authorization: Bearer $NOTION_API_KEY"`
  - Do not wrap this header in single quotes.
