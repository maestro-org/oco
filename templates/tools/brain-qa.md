# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Inputs and Scope

- Primary source registry file: `DATA_SOURCES.md` in the current workspace.
- On broad company/repo questions, load `DATA_SOURCES.md` first to determine allowed sources.
- If `DATA_SOURCES.md` is missing or incomplete, ask the operator to update it before deep answers.
- Expected source inputs:
  - GitHub repos
  - Internal/public documentation URLs
  - Team docs provided by the user
- Ask for missing source lists before doing broad Q&A.

## GitHub Read Workflow

- `GITHUB_TOKEN` should be preconfigured.
- Verify access:

```bash
curl -sS https://api.github.com/user -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

- Read repo metadata:

```bash
curl -sS "https://api.github.com/repos/<OWNER>/<REPO>" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

## Documentation Workflow

- Use direct URLs from the user when available.
- Prefer first-party docs pages and canonical READMEs.
- Keep source links in your final response.

## Answer Format

1. Direct answer.
2. Evidence summary.
3. Source references.
4. Open questions or gaps.

## Guardrails

- Default to read-only behavior.
- Do not create/update repo issues/PRs unless explicitly asked.
- If confidence is low, state why and what data is missing.
