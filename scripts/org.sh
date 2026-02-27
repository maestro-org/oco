#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 ]]; then
  cat >&2 <<USAGE
Usage: $0 <org> <oco-args...>
Examples:
  $0 acme validate
  $0 acme runtime ps --instance core-human
  $0 beta-org runtime up --instance core-human
USAGE
  exit 1
fi

ORG_RAW="$1"
shift

ORG="$(printf '%s' "$ORG_RAW" | tr '[:upper:]' '[:lower:]')"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCO="$ROOT_DIR/scripts/oco.sh"

INV_LOCAL="inventory/${ORG}.instances.local.yaml"
INV_TRACKED="inventory/${ORG}.instances.yaml"
if [[ -f "$ROOT_DIR/$INV_LOCAL" ]]; then
  INVENTORY_PATH="$INV_LOCAL"
elif [[ -f "$ROOT_DIR/$INV_TRACKED" ]]; then
  INVENTORY_PATH="$INV_TRACKED"
elif [[ "$ORG" == "maestro" && -f "$ROOT_DIR/inventory/instances.local.yaml" ]]; then
  INVENTORY_PATH="inventory/instances.local.yaml"
elif [[ "$ORG" == "maestro" && -f "$ROOT_DIR/inventory/instances.yaml" ]]; then
  INVENTORY_PATH="inventory/instances.yaml"
else
  echo "error: no inventory found for org '$ORG' (expected $INV_LOCAL or $INV_TRACKED)" >&2
  exit 1
fi

ENV_FILE="${ORG_ENV_FILE:-.env.${ORG}}"
if [[ -f "$ROOT_DIR/$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/$ENV_FILE"
  set +a
fi

exec "$OCO" --inventory "$INVENTORY_PATH" "$@"
