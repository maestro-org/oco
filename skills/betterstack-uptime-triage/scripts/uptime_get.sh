#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BETTERSTACK_API_BASE_URL:-https://uptime.betterstack.com/api/v2}"
API_TOKEN="${BETTERSTACK_API_TOKEN:?BETTERSTACK_API_TOKEN is required}"
ENDPOINT_PATH="${1:-/incidents}"

if [[ "$ENDPOINT_PATH" != /* ]]; then
  ENDPOINT_PATH="/$ENDPOINT_PATH"
fi

curl -sS "${BASE_URL%/}${ENDPOINT_PATH}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json"
