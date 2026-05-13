#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -d apps/web/node_modules ] || [ ! -d apps/api/node_modules ] || [ ! -d apps/agent/.venv ]; then
  echo "Dependencies missing. Running setup first..."
  bash "$ROOT_DIR/scripts/setup.sh"
fi

exec bash "$ROOT_DIR/scripts/dev.sh"
