# Google Calendar Rollout Template (Google Workspace CLI / `gws`)

This runbook is reusable for any OCO agent and instance that needs delegated Google Calendar writes through `gws`.

## 1. Prerequisites (Google Workspace Admin)

1. Create a Google Cloud service account for calendar automation.
2. Enable Google Calendar API in the same GCP project.
3. Enable domain-wide delegation for that service account.
4. In Google Admin, authorize scope:
   - `https://www.googleapis.com/auth/calendar.events`
5. Ensure delegated mailbox exists (example: `<agent-id>.bot@your-domain.org`).

## 2. Local Secret Placement

Place the service-account key JSON on the host at:

`instances/<instance-id>/state/secrets/gws-service-account.json`

Expected in-container path:

`/var/lib/openclaw/state/secrets/gws-service-account.json`

Recommended permissions:

```bash
chmod 600 instances/<instance-id>/state/secrets/gws-service-account.json
```

## 3. Required Environment Variables

Set these in the instance runtime environment:

- `GWS_IMPERSONATED_EMAIL` (delegated mailbox user)
- `GWS_SERVICE_ACCOUNT_KEY_FILE` (in-container path to key JSON)
- `GWS_SCOPE` (normally `https://www.googleapis.com/auth/calendar.events`)
- `GWS_CALENDAR_ID` (usually `primary`)

`GOOGLE_WORKSPACE_CLI_*` settings are also required by the CLI state store.

## 4. Build Gateway Image with `gws`

```bash
docker build -f instances/<instance-id>/config/Dockerfile.custom -t openclaw-<instance-id>-custom:2026.3.13-1-r1 .
```

## 5. Rollout Sequence

```bash
oco --inventory inventory/instances.local.yaml validate
oco --inventory inventory/instances.local.yaml policy validate
oco --inventory inventory/instances.local.yaml render --instance <instance-id>
oco --inventory inventory/instances.local.yaml compose generate --instance <instance-id>
./scripts/deploy-instance.sh <instance-id>
oco --inventory inventory/instances.local.yaml health --instance <instance-id>
docker compose -f .generated/<instance-id>/docker-compose.yaml exec -T gateway node /app/openclaw.mjs doctor
```

## 6. Auth Delegation Check + Smoke Test

```bash
docker compose -f .generated/<instance-id>/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/gws-auth-login.sh
docker compose -f .generated/<instance-id>/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/gws-auth-test.sh
docker compose -f .generated/<instance-id>/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/gws-calendar-insert.sh --summary "GWS Smoke Test" --start "2026-03-10T17:00:00-07:00" --end "2026-03-10T17:15:00-07:00" --description "Delete after verification"
```

## 7. Runtime Scripts

- Access token (ephemeral):
  - `/var/lib/openclaw/config/scripts/gws-access-token.sh`
- Auth login:
  - `/var/lib/openclaw/config/scripts/gws-auth-login.sh`
- Auth test:
  - `/var/lib/openclaw/config/scripts/gws-auth-test.sh`
- Insert event:
  - `/var/lib/openclaw/config/scripts/gws-calendar-insert.sh`

## 8. Backward Compatibility

For existing live installs, legacy `DAVIS_GWS_*` env vars are still accepted as fallbacks when `GWS_*` are not set.
