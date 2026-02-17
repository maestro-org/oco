#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 4 ]]; then
  cat >&2 <<USAGE
Usage: $0 <instance-id> <agent-id> <role:human|usecase> <channel:accountId> [model]
Example:
  $0 core-human procurement usecase telegram:procurement openai/gpt-4.1-mini
USAGE
  exit 1
fi

INSTANCE_ID="$1"
AGENT_ID="$2"
ROLE="$3"
ACCOUNT="$4"
MODEL="${5:-}"
INVENTORY_PATH="${INVENTORY_PATH:-inventory/instances.yaml}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCO="$ROOT_DIR/scripts/oco.sh"

channel="${ACCOUNT%%:*}"

args=(--inventory "$INVENTORY_PATH" agent add --instance "$INSTANCE_ID" --agent-id "$AGENT_ID" --role "$ROLE" --account "$ACCOUNT" --integration "$channel")

if [[ -n "$MODEL" ]]; then
  args+=(--model "$MODEL")
fi

"$OCO" "${args[@]}"
"$OCO" --inventory "$INVENTORY_PATH" compose restart --instance "$INSTANCE_ID"
"$OCO" --inventory "$INVENTORY_PATH" agent list --instance "$INSTANCE_ID"
