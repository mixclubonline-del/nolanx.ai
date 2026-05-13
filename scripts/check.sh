#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Secret scan..."
if rg -n "sk-(live|test|proj)-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|eyJhbGci|AKIA[0-9A-Z]{16}|secret_access_key\\s*=\\s*\\\"[a-f0-9]{24,}\\\"|api_key\\s*=\\s*\\\"(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\\\"" . -S \
  --glob '!apps/web/pnpm-lock.yaml' \
  --glob '!apps/api/pnpm-lock.yaml' \
  --glob '!apps/agent/config.example.toml' \
  --glob '!apps/agent/config.toml' \
  --glob '!scripts/check.sh'; then
  echo "Potential secrets found. Clean them before publishing."
  exit 1
fi

echo "Type/build checks..."
pnpm --dir apps/api build
pnpm --dir apps/web build

echo "Python syntax check..."
cd "$ROOT_DIR/apps/agent"
if [ -x .venv/bin/python ]; then
  .venv/bin/python -m py_compile main.py services/config_service.py services/nolanx_service.py
else
  python3 -m py_compile main.py services/config_service.py services/nolanx_service.py
fi

echo "All checks passed."
