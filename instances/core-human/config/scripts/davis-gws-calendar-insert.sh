#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  davis-gws-calendar-insert.sh --summary "<text>" --start "<RFC3339>" --end "<RFC3339>" [options]

Options:
  --calendar-id "<id>"          Defaults to DAVIS_GWS_CALENDAR_ID or "primary"
  --timezone "<tz>"             Example: America/Los_Angeles
  --location "<text>"
  --description "<text>"
  --attendees "<email1,email2>"
  --conference-data "<json>"
  -h, --help

Example:
  davis-gws-calendar-insert.sh \
    --summary "Design review" \
    --start "2026-03-08T17:00:00-08:00" \
    --end "2026-03-08T17:30:00-08:00" \
    --attendees "a@example.com,b@example.com"
EOF
}

is_rfc3339() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$ ]]
}

CALENDAR_ID="${DAVIS_GWS_CALENDAR_ID:-primary}"
SUMMARY=""
START=""
END=""
TIMEZONE=""
LOCATION=""
DESCRIPTION=""
ATTENDEES=""
CONFERENCE_DATA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary)
      SUMMARY="${2:-}"
      shift 2
      ;;
    --start)
      START="${2:-}"
      shift 2
      ;;
    --end)
      END="${2:-}"
      shift 2
      ;;
    --calendar-id)
      CALENDAR_ID="${2:-}"
      shift 2
      ;;
    --timezone)
      TIMEZONE="${2:-}"
      shift 2
      ;;
    --location)
      LOCATION="${2:-}"
      shift 2
      ;;
    --description)
      DESCRIPTION="${2:-}"
      shift 2
      ;;
    --attendees)
      ATTENDEES="${2:-}"
      shift 2
      ;;
    --conference-data)
      CONFERENCE_DATA="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SUMMARY}" || -z "${START}" || -z "${END}" ]]; then
  echo "Error: --summary, --start, and --end are required." >&2
  usage >&2
  exit 1
fi

if ! is_rfc3339 "${START}"; then
  echo "Error: --start must be RFC3339 (e.g., 2026-03-08T17:00:00-08:00)." >&2
  exit 1
fi

if ! is_rfc3339 "${END}"; then
  echo "Error: --end must be RFC3339 (e.g., 2026-03-08T17:30:00-08:00)." >&2
  exit 1
fi

TOKEN_SCRIPT="/var/lib/openclaw/config/scripts/davis-gws-access-token.sh"
ACCESS_TOKEN="$("${TOKEN_SCRIPT}")"

export CALENDAR_ID SUMMARY START END TIMEZONE LOCATION DESCRIPTION ATTENDEES CONFERENCE_DATA
EVENT_JSON="$(
  python3 - <<'PY'
import json
import os

event = {
    "summary": os.environ["SUMMARY"],
    "start": {"dateTime": os.environ["START"]},
    "end": {"dateTime": os.environ["END"]},
}

timezone = os.environ.get("TIMEZONE", "").strip()
if timezone:
    event["start"]["timeZone"] = timezone
    event["end"]["timeZone"] = timezone

location = os.environ.get("LOCATION", "").strip()
if location:
    event["location"] = location

description = os.environ.get("DESCRIPTION", "").strip()
if description:
    event["description"] = description

attendees = [email.strip() for email in os.environ.get("ATTENDEES", "").split(",") if email.strip()]
if attendees:
    event["attendees"] = [{"email": email} for email in attendees]

conference_data_raw = os.environ.get("CONFERENCE_DATA", "").strip()
if conference_data_raw:
    event["conferenceData"] = json.loads(conference_data_raw)

print(json.dumps(event, separators=(",", ":")))
PY
)"

PARAMS_JSON="$(
  python3 - <<'PY'
import json
import os

params = {
    "calendarId": os.environ["CALENDAR_ID"],
    "sendUpdates": "none",
}

if os.environ.get("CONFERENCE_DATA", "").strip():
    params["conferenceDataVersion"] = 1

print(json.dumps(params, separators=(",", ":")))
PY
)"

exec env GOOGLE_WORKSPACE_CLI_TOKEN="${ACCESS_TOKEN}" \
  gws calendar events insert \
    --params "${PARAMS_JSON}" \
    --json "${EVENT_JSON}"
