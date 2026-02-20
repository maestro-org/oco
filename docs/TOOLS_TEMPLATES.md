# TOOLS Templates

This guide explains how to define, customize, and apply `TOOLS.md` files using `oco`.

## 1. Template Location

Default template directory:

`templates/tools/`

Built-in templates:
- `business-development`
- `brain-qa`
- `deep-research`
- `github-manager`
- `infra-triage`
- `notion-manager`
- `operations`
- `product`

List available templates:

```bash
oco tools list
```

## 2. Apply a Template to an Existing Agent

```bash
oco tools apply \
  --instance core-human \
  --agent-id drichardson \
  --template business-development
```

If a `TOOLS.md` already exists, overwrite with:

```bash
oco tools apply \
  --instance core-human \
  --agent-id drichardson \
  --template business-development \
  --force
```

## 3. Apply a Template While Creating a New Agent

```bash
oco agent add \
  --instance core-human \
  --agent-id saugustine \
  --role operations \
  --account telegram:scott_augustine \
  --integration telegram \
  --model openai/gpt-4.1-mini \
  --tools-template operations
```

`oco` will add the agent and write `TOOLS.md` to that agent workspace.

You can combine both templates:

```bash
oco agent add ... --soul-template operations --tools-template operations
```

## 4. Customize Templates

1. Create or edit a template file in `templates/tools/`:

`templates/tools/<your-template>.md`

2. Apply it with:

```bash
oco tools apply --instance core-human --agent-id <agent-id> --template <your-template>
```

## 5. Supported Placeholders

Templates support these placeholders:

- `{{AGENT_ID}}`
- `{{AGENT_NAME}}`
- `{{AGENT_ROLE}}`
- `{{INSTANCE_ID}}`
- `{{ORG_NAME}}`
- `{{PRIMARY_CHANNEL}}`
- `{{PRIMARY_ACCOUNT_ID}}`
- `{{ACCOUNT_IDS}}`
- `{{BINDINGS}}`

Unknown placeholders are left unchanged.

## 6. Alternate Template Directory (Optional)

Override template lookup directory:

```bash
export OCO_TOOLS_TEMPLATES_DIR=/path/to/tools-templates
```

Then run the same `oco tools list` / `oco tools apply` commands.
