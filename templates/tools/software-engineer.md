# TOOLS.md

## Operator Notes

- Agent: `{{AGENT_NAME}}` (`{{AGENT_ID}}`)
- Role: `{{AGENT_ROLE}}`
- Organization: `{{ORG_NAME}}`
- Primary binding: `{{PRIMARY_CHANNEL}}:{{PRIMARY_ACCOUNT_ID}}`

## Default Engineering Workflow

1. Confirm objective, constraints, and expected output.
2. Gather current repo/runtime state before proposing changes.
3. Propose smallest viable change plan.
4. Implement, validate, and report exact results.

## GitHub

- `GITHUB_TOKEN` is expected to be preconfigured by operators.
- Confirm auth before write operations:

```bash
curl -sS https://api.github.com/user -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json"
```

## Change Safety

- Show plan before high-impact write operations.
- Run relevant tests for touched scope before finalizing.
- Include rollback notes when changing runtime behavior.
- Prefer explicit file/line references in summaries.
