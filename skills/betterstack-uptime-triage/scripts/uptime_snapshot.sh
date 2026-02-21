#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BETTERSTACK_API_BASE_URL:-https://uptime.betterstack.com/api/v2}"
API_TOKEN="${BETTERSTACK_API_TOKEN:?BETTERSTACK_API_TOKEN is required}"
OUT_DIR="${1:-/tmp/betterstack-uptime-snapshot}"
mkdir -p "$OUT_DIR"

curl -sS "${BASE_URL%/}/incidents" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  > "$OUT_DIR/incidents.json"

curl -sS "${BASE_URL%/}/monitors" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  > "$OUT_DIR/monitors.json"

printf 'wrote %s\n' "$OUT_DIR/incidents.json"
printf 'wrote %s\n' "$OUT_DIR/monitors.json"
