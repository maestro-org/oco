# BetterStack Uptime API Reference Notes

Primary docs:
- Getting started: https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/
- Monitors endpoint index: https://betterstack.com/docs/uptime/api/list-all-existing-monitors/
- Incidents endpoint index: https://betterstack.com/docs/uptime/api/list-existing-incidents/

## Authentication
Use bearer token auth via `Authorization: Bearer <token>`.

## Base URL
Default Uptime API base URL shown in docs:
- `https://uptime.betterstack.com/api/v2`

## Common Triage Endpoints
- `/monitors`
- `/incidents`

Use monitor and incident payloads together for:
- current outage scope
- impacted services/components
- incident timeline and status
