# Google Calendar Rollout Template (`bob` Placeholder, `core-human` Instance)

This runbook uses `bob` as a placeholder so the flow is reusable for any agent integration with `gws` on the existing `core-human` instance.

If you are applying this to Davis today, replace `bob` with `davis` and `bob.bot@gomaestro.org` with `drichardson.bot@gomaestro.org`.

## Placeholder Mapping

- Agent ID: `bob`
- Delegated mailbox: `bob.bot@gomaestro.org`
- Secret filename: `bob-gws-service-account.json`
- Script prefix: `bob-gws-...`

## 1. Prerequisites (Google Workspace Admin)

1. Create a Google Cloud service account for `bob` calendar automation.
2. Enable Google Calendar API in the same GCP project.
3. Enable domain-wide delegation for that service account.
4. In Google Admin, authorize scope:
   - `https://www.googleapis.com/auth/calendar.events`
5. Ensure delegated user mailbox exists:
   - `bob.bot@gomaestro.org`

## 2. Local Secret Placement

Place the service-account key JSON on the host at:

`instances/core-human/state/secrets/bob-gws-service-account.json`

Expected in-container path:

`/var/lib/openclaw/state/secrets/bob-gws-service-account.json`

Recommended permissions:

```bash
chmod 600 instances/core-human/state/secrets/bob-gws-service-account.json
```

## 3. Build the Gateway Image with `gws`

```bash
docker build -f instances/core-human/config/Dockerfile.custom -t openclaw-core-human-custom:2026.2.22-r1 .
```

## 4. Rollout Sequence

```bash
oco --inventory inventory/instances.local.yaml validate
oco --inventory inventory/instances.local.yaml policy validate
oco --inventory inventory/instances.local.yaml render --instance core-human
oco --inventory inventory/instances.local.yaml compose generate --instance core-human
./scripts/deploy-instance.sh core-human
oco --inventory inventory/instances.local.yaml health --instance core-human
docker compose -f .generated/core-human/docker-compose.yaml exec -T gateway node /app/openclaw.mjs doctor
```

## 5. Auth Delegation Check + Smoke Test

```bash
docker compose -f .generated/core-human/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/bob-gws-auth-login.sh
docker compose -f .generated/core-human/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/bob-gws-auth-test.sh
docker compose -f .generated/core-human/docker-compose.yaml exec -T gateway /var/lib/openclaw/config/scripts/bob-gws-calendar-insert.sh --summary "Bob GWS Smoke Test" --start "2026-03-10T17:00:00-07:00" --end "2026-03-10T17:15:00-07:00" --description "Delete after verification"
```

## 6. Runtime Scripts

- Access token (ephemeral):
  - `/var/lib/openclaw/config/scripts/bob-gws-access-token.sh`
- Auth login:
  - `/var/lib/openclaw/config/scripts/bob-gws-auth-login.sh`
- Auth test:
  - `/var/lib/openclaw/config/scripts/bob-gws-auth-test.sh`
- Insert event:
  - `/var/lib/openclaw/config/scripts/bob-gws-calendar-insert.sh`

These scripts enforce configured account defaults and RFC3339 time format.
