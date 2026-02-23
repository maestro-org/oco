# TOOLS Templates

This guide explains how to define, customize, and apply `TOOLS.md` files with `oco`.

## 1. Template Location

Default directory:

`templates/tools/`

List templates:

```bash
oco tools list
```

## 2. Apply to an Existing Agent

```bash
oco tools apply \
  --instance core-human \
  --agent-id support \
  --template operations
```

Overwrite existing `TOOLS.md`:

```bash
oco tools apply \
  --instance core-human \
  --agent-id support \
  --template operations \
  --force
```

## 3. Apply During Agent Creation

```bash
oco agent add \
  --instance core-human \
  --agent-id support \
  --role usecase \
  --account telegram:support \
  --integration telegram \
  --model openai/gpt-5.1 \
  --tools-template operations
```

Use both template types at add-time:

```bash
oco agent add ... --soul-template operations --tools-template operations
```

## 4. Create/Customize Templates

1. Create or edit:

`templates/tools/<your-template>.md`

2. Apply:

```bash
oco tools apply --instance <instance-id> --agent-id <agent-id> --template <your-template>
```

## 5. Supported Placeholders

- `{{AGENT_ID}}`
- `{{AGENT_NAME}}`
- `{{AGENT_ROLE}}`
- `{{INSTANCE_ID}}`
- `{{ORG_NAME}}`
- `{{PRIMARY_CHANNEL}}`
- `{{PRIMARY_ACCOUNT_ID}}`
- `{{ACCOUNT_IDS}}`
- `{{BINDINGS}}`

Unknown placeholders remain unchanged.

## 6. Alternate Template Directory

```bash
export OCO_TOOLS_TEMPLATES_DIR=/path/to/tools-templates
```
