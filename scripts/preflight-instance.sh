#!/usr/bin/env bash
set -euo pipefail

if command -v oco >/dev/null 2>&1; then
  CLI="oco"
elif command -v bun >/dev/null 2>&1; then
  CLI="bun run dist/cli.js"
else
  CLI="node dist/cli.js"
fi

INVENTORY_PATH="${INVENTORY_PATH:-}"

INV_ARGS=()
if [[ -n "$INVENTORY_PATH" ]]; then
  INV_ARGS=(--inventory "$INVENTORY_PATH")
fi

$CLI "${INV_ARGS[@]}" validate
$CLI "${INV_ARGS[@]}" policy validate
$CLI "${INV_ARGS[@]}" render --instance core-human
$CLI "${INV_ARGS[@]}" runtime generate --instance core-human
$CLI "${INV_ARGS[@]}" preflight --instance core-human
