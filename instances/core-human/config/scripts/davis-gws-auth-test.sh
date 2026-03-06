#!/usr/bin/env bash
set -euo pipefail

TOKEN_SCRIPT="/var/lib/openclaw/config/scripts/davis-gws-access-token.sh"
CALENDAR_ID="${DAVIS_GWS_CALENDAR_ID:-primary}"
ACCESS_TOKEN="$("${TOKEN_SCRIPT}")"

exec env GOOGLE_WORKSPACE_CLI_TOKEN="${ACCESS_TOKEN}" \
  gws calendar events list \
    --params "{\"calendarId\":\"${CALENDAR_ID}\",\"maxResults\":1,\"singleEvents\":true,\"orderBy\":\"startTime\"}"
