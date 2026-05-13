#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install it with: corepack enable && corepack prepare pnpm@9.15.4 --activate"
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "python3 is required."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [ ! -f apps/agent/config.toml ]; then
  cp apps/agent/config.example.toml apps/agent/config.toml
  echo "Created apps/agent/config.toml"
fi

mkdir -p apps/agent/user_data/files apps/agent/user_data/nolanx-memory

echo "Installing Node dependencies..."
pnpm install

echo "Creating Python virtual environment..."
cd "$ROOT_DIR/apps/agent"
if [ ! -d .venv ]; then
  "$PYTHON_BIN" -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "Setup complete. Start everything with: pnpm dev"
