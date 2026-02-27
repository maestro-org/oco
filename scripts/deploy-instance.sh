#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${1:-core-human}"
INVENTORY_PATH="${INVENTORY_PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCO="$ROOT_DIR/scripts/oco.sh"

INV_ARGS=()
if [[ -n "$INVENTORY_PATH" ]]; then
  if [[ ! -f "$INVENTORY_PATH" && ! -f "$ROOT_DIR/$INVENTORY_PATH" ]]; then
    echo "error: inventory file not found: $INVENTORY_PATH" >&2
    exit 1
  fi
  INV_ARGS=(--inventory "$INVENTORY_PATH")
fi

echo "[1/6] Validate inventory and policy"
"$OCO" "${INV_ARGS[@]}" validate
"$OCO" "${INV_ARGS[@]}" policy validate

echo "[2/6] Render configuration"
"$OCO" "${INV_ARGS[@]}" render --instance "$INSTANCE_ID"

echo "[3/6] Generate runtime manifest"
"$OCO" "${INV_ARGS[@]}" compose generate --instance "$INSTANCE_ID"

echo "[4/6] Preflight checks"
"$OCO" "${INV_ARGS[@]}" preflight --instance "$INSTANCE_ID"

echo "[5/6] Deploy/update instance (provider-aware)"
"$OCO" "${INV_ARGS[@]}" compose up --instance "$INSTANCE_ID"

echo "[6/6] Health check"
"$OCO" "${INV_ARGS[@]}" health --instance "$INSTANCE_ID"

echo "Deployment flow completed for instance '$INSTANCE_ID'."
