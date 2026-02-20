# DATA_SOURCES Convention

Use `DATA_SOURCES.md` as the source-of-truth file for knowledge and research agents.

## 1. File Location

Create one file per agent workspace:

- `instances/<instance-id>/workspaces/<agent-id>/DATA_SOURCES.md`

Reusable starter template:

- `templates/data-sources/knowledge.md`

## 2. Required Sections

- `Scope`: owner, purpose, update date.
- `GitHub Repositories`: allowed repos and scope.
- `Documentation URLs`: canonical links and trust tier.
- `Notion / Internal Docs`: IDs/URLs and sharing scope.
- `Inclusion/Exclusion Rules`: explicit in-bounds vs out-of-bounds.

## 3. Agent Behavior Contract

For `brain-qa` and `deep-research` style agents:
- load `DATA_SOURCES.md` before broad discovery or synthesis tasks
- prioritize listed sources first
- request source updates when coverage is insufficient
- cite source links in outputs

## 4. Update Workflow

1. Edit `DATA_SOURCES.md`.
2. Re-run the question or research task.
3. Verify outputs cite only approved sources.

## 5. Example Bootstrap

```bash
cp templates/data-sources/knowledge.md instances/<knowledge-instance-id>/workspaces/brain-qa/DATA_SOURCES.md
cp templates/data-sources/knowledge.md instances/<knowledge-instance-id>/workspaces/deep-research/DATA_SOURCES.md
```
