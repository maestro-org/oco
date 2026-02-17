#!/usr/bin/env bash
set -euo pipefail

if command -v oco >/dev/null 2>&1; then
  CLI="oco"
elif command -v bun >/dev/null 2>&1; then
  CLI="bun run dist/cli.js"
else
  CLI="node dist/cli.js"
fi

$CLI validate
$CLI policy validate
$CLI render --instance core-human
$CLI compose generate --instance core-human
$CLI preflight --instance core-human
