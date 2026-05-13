#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
elif [ -f .env.example ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.example
  set +a
fi

export NODE_ENV="${NODE_ENV:-development}"
export SITE_VARIANT="${SITE_VARIANT:-nolanx}"
export NEXT_PUBLIC_SITE_VARIANT="${NEXT_PUBLIC_SITE_VARIANT:-nolanx}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8080}"
export NEXT_PUBLIC_WS_SERVER_URL="${NEXT_PUBLIC_WS_SERVER_URL:-http://localhost:52178}"
export NOLANX_ALLOW_MOCK_SERVICES="${NOLANX_ALLOW_MOCK_SERVICES:-true}"
export PORT="${PORT:-8080}"
export INTERNAL_API_KEY="${INTERNAL_API_KEY:-dev-internal-api-key}"
export WEB_PORT="${WEB_PORT:-3000}"
export AGENT_HOST="${AGENT_HOST:-127.0.0.1}"
export AGENT_PORT="${AGENT_PORT:-52178}"
export AUTO_OPEN_BROWSER="${AUTO_OPEN_BROWSER:-true}"

if [ ! -d apps/web/node_modules ] || [ ! -d apps/api/node_modules ] || [ ! -d apps/agent/.venv ]; then
  echo "Dependencies are missing. Run: pnpm setup"
  exit 1
fi

cleanup_existing_port() {
  local port="$1"
  local root_hint="$2"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -z "$pids" ] && return 0

  local own_pids=""
  local foreign_pids=""
  for pid in $pids; do
    local cmd
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if printf '%s' "$cmd" | grep -Fq "$root_hint"; then
      own_pids="$own_pids $pid"
    else
      foreign_pids="$foreign_pids $pid"
    fi
  done

  if [ -n "$own_pids" ]; then
    echo "Stopping existing NolanX process on port $port:$own_pids"
    kill $own_pids 2>/dev/null || true
    sleep 1
  fi

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is still in use by another process."
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
    exit 1
  fi
}

cleanup_existing_port "$WEB_PORT" "$ROOT_DIR/apps/web"
cleanup_existing_port "$PORT" "$ROOT_DIR/apps/api"
cleanup_existing_port "$AGENT_PORT" "$ROOT_DIR/apps/agent"

rm -rf "$ROOT_DIR/apps/web/.next"

open_browser() {
  local url="$1"
  if [ "${AUTO_OPEN_BROWSER}" != "true" ]; then
    return 0
  fi

  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v start >/dev/null 2>&1; then
    start "$url" >/dev/null 2>&1 || true
  fi
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"
  local delay="${3:-1}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting NolanX web on http://localhost:${WEB_PORT}"
PORT="${WEB_PORT}" pnpm --dir apps/web dev &

echo "Starting NolanX API on http://localhost:${PORT}"
pnpm --dir apps/api dev &

echo "Starting NolanX agent on http://${AGENT_HOST}:${AGENT_PORT}"
(
  cd apps/agent
  .venv/bin/python main.py --host "${AGENT_HOST}" --port "${AGENT_PORT}"
) &

(
  if wait_for_http "http://localhost:${WEB_PORT}/nolanx" 90 1; then
    echo "Opening NolanX web in browser..."
    open_browser "http://localhost:${WEB_PORT}/nolanx"
  fi
) &

wait
