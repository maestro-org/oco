# SOUL Templates

This guide explains how to define, customize, and apply `SOUL.md` files with `oco`.

## 1. Template Location

Default directory:

`templates/souls/`

List templates:

```bash
oco soul list
```

## 2. Apply to an Existing Agent

```bash
oco soul apply \
  --instance core-human \
  --agent-id support \
  --template operations
```

Overwrite existing `SOUL.md`:

```bash
oco soul apply \
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
  --soul-template operations
```

## 4. Create/Customize Templates

1. Create or edit:

`templates/souls/<your-template>.md`

2. Apply:

```bash
oco soul apply --instance <instance-id> --agent-id <agent-id> --template <your-template>
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
export OCO_SOUL_TEMPLATES_DIR=/path/to/soul-templates
```
