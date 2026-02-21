---
name: betterstack-uptime-triage
description: BetterStack Uptime incident and monitor triage workflow. Use when asked to inspect BetterStack Uptime status, summarize current incidents, identify likely impact, or propose immediate mitigation and follow-up actions based on Uptime API data.
---

# BetterStack Uptime Triage

## Overview
Use this skill to fetch BetterStack Uptime monitor and incident data, classify impact, and provide operator-ready triage output.

## Execute Workflow
1. Verify required credentials:
- `BETTERSTACK_API_TOKEN`
- `BETTERSTACK_API_BASE_URL` (default `https://uptime.betterstack.com/api/v2` if missing)

2. Capture current Uptime signals:
- Use `scripts/uptime_snapshot.sh` for a standard monitor+incident pull.
- Use `scripts/uptime_get.sh` for targeted endpoint pulls.
- Use `scripts/uptime_incident_names.sh` for incident-name summaries.

3. Summarize incident state:
- active incidents
- affected monitors/components
- customer/reliability impact
- start time and current status

4. Classify output explicitly:
- facts (API-confirmed)
- hypotheses (likely causes)
- unknowns (data still needed)

5. Recommend actions:
- immediate containment/mitigation
- verification steps
- durable follow-up actions
- owner + ETA proposal

## Scripts

### `scripts/uptime_snapshot.sh`
Run a standard snapshot and store JSON files for current incidents and monitors.

```bash
bash scripts/uptime_snapshot.sh
```

### `scripts/uptime_get.sh`
Fetch any Uptime API endpoint path quickly.

```bash
bash scripts/uptime_get.sh /incidents
bash scripts/uptime_get.sh /monitors
```

### `scripts/uptime_incident_names.sh`
Return incident names as a numbered list, without `jq`.

```bash
bash scripts/uptime_incident_names.sh 5
```

## Critical Rules
- Do not use `jq` (it is unavailable in this runtime).
- Do not call `/api/v1/*` endpoints.
- Do not append `/api/v2` manually if `BETTERSTACK_API_BASE_URL` already includes it.
- Prefer the provided scripts over ad-hoc curl commands.

## Output Contract
Return triage output in this order:
1. Current status
2. Impact summary
3. Findings (fact/hypothesis/unknown)
4. Immediate actions
5. Follow-up plan

## Guardrails
- Do not claim incident resolution without verification evidence.
- Do not execute production changes without explicit operator approval.
- Keep recommendations reversible first, invasive changes second.

## References
- BetterStack Uptime API quick start and endpoint patterns: `references/uptime-api.md`
