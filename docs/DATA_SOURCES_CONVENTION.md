# DATA_SOURCES Convention

Use `DATA_SOURCES.md` as the source-of-truth file for knowledge and research agents.

## 1. File Location

Create one file per relevant agent workspace:

- `instances/<instance-id>/workspaces/<agent-id>/DATA_SOURCES.md`

For reusable starting content:

- `templates/data-sources/knowledge.md`

## 2. Required Sections

- `Scope`: owner, purpose, update date.
- `GitHub Repositories`: repo URLs and allowed scope.
- `Documentation URLs`: canonical docs and trust tier.
- `Notion / Internal Docs`: IDs or URLs and sharing scope.
- `Inclusion/Exclusion Rules`: what is in-bounds vs out-of-bounds.

## 3. Agent Behavior Contract

For `brain-qa` and `deep-research` style agents:

- Load `DATA_SOURCES.md` before broad discovery or synthesis tasks.
- Prefer listed sources first.
- If source coverage is insufficient, request operator update rather than guessing.
- Cite source links in outputs.

## 4. Update Workflow

1. Edit `DATA_SOURCES.md`.
2. Re-run the relevant question/research request.
3. Verify output cites only intended sources.

## 5. Example Bootstrap

```bash
cp templates/data-sources/knowledge.md instances/maestro-discord-knowledge/workspaces/brain-qa/DATA_SOURCES.md
cp templates/data-sources/knowledge.md instances/maestro-discord-knowledge/workspaces/deep-research/DATA_SOURCES.md
```
