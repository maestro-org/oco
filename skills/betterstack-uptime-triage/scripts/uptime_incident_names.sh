#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BETTERSTACK_API_BASE_URL:-https://uptime.betterstack.com/api/v2}"
API_TOKEN="${BETTERSTACK_API_TOKEN:?BETTERSTACK_API_TOKEN is required}"
LIMIT="${1:-5}"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "limit must be an integer" >&2
  exit 2
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

curl -sS "${BASE_URL%/}/incidents" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  > "$TMP_JSON"

node - "$TMP_JSON" "$LIMIT" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const limit = Number.parseInt(process.argv[3], 10);
const raw = fs.readFileSync(file, 'utf8');
let doc;
try {
  doc = JSON.parse(raw);
} catch (err) {
  console.error('invalid JSON from BetterStack incidents endpoint');
  process.exit(3);
}

const rows = Array.isArray(doc?.data) ? doc.data : [];
const names = rows
  .map((item) => item?.attributes?.name)
  .filter((v) => typeof v === 'string' && v.trim().length > 0)
  .slice(0, limit);

if (names.length === 0) {
  console.log('No incident names found.');
  process.exit(0);
}

for (let i = 0; i < names.length; i += 1) {
  console.log(`${i + 1}. ${names[i]}`);
}
NODE
