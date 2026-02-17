#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  exec bun run dist/cli.js "$@"
fi

if [[ -x "$HOME/.bun/bin/bun" ]]; then
  exec "$HOME/.bun/bin/bun" run dist/cli.js "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node dist/cli.js "$@"
fi

if command -v oco >/dev/null 2>&1; then
  exec oco "$@"
fi

echo "error: bun, node, or oco is required" >&2
exit 1
