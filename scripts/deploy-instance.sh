#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${1:-core-human}"
INVENTORY_PATH="${INVENTORY_PATH:-inventory/instances.yaml}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCO="$ROOT_DIR/scripts/oco.sh"

if [[ ! -f "$ROOT_DIR/$INVENTORY_PATH" ]]; then
  echo "error: inventory file not found: $INVENTORY_PATH" >&2
  exit 1
fi

echo "[1/6] Validate inventory and policy"
"$OCO" --inventory "$INVENTORY_PATH" validate
"$OCO" --inventory "$INVENTORY_PATH" policy validate

echo "[2/6] Render configuration"
"$OCO" --inventory "$INVENTORY_PATH" render --instance "$INSTANCE_ID"

echo "[3/6] Generate compose manifest"
"$OCO" --inventory "$INVENTORY_PATH" compose generate --instance "$INSTANCE_ID"

echo "[4/6] Preflight checks"
"$OCO" --inventory "$INVENTORY_PATH" preflight --instance "$INSTANCE_ID"

echo "[5/6] Deploy/update instance"
"$OCO" --inventory "$INVENTORY_PATH" compose up --instance "$INSTANCE_ID"

echo "[6/6] Health check"
"$OCO" --inventory "$INVENTORY_PATH" health --instance "$INSTANCE_ID"

echo "Deployment flow completed for instance '$INSTANCE_ID'."
