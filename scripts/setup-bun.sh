#!/usr/bin/env bash

set -euo pipefail

BUN_VERSION="$(tr -d '\n' < .bun-version)"
BUN_VERSION="${BUN_VERSION#bun-v}"
BUN_VERSION="${BUN_VERSION#v}"

if ! command -v unzip >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y unzip
fi

curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
