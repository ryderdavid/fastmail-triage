#!/usr/bin/env bash

# Fastmail triage: one-shot launcher for backend + frontend.
# Kills any existing processes on configured ports before starting fresh.
# Usage (defaults shown):
#   BACKEND_DIR=. BACKEND_CMD="npm run server" BACKEND_PORT=3001 \
#   FRONTEND_DIR=. FRONTEND_CMD="npm run dev -- --host --port 5173" \
#   FRONTEND_PORT=5173 FRONTEND_URL=http://localhost:5173 \
#   LOG_DIR=./logs WAIT_TIMEOUT=60 ./dev.sh
# Override env vars above to match your setup. Script exits non-zero on failure.

set -euo pipefail

BACKEND_DIR=${BACKEND_DIR:-.}
BACKEND_CMD=${BACKEND_CMD:-"npm run server"}
BACKEND_PORT=${BACKEND_PORT:-3001}

FRONTEND_DIR=${FRONTEND_DIR:-.}
FRONTEND_CMD=${FRONTEND_CMD:-"npm run dev -- --host --port 5173"}
FRONTEND_PORT=${FRONTEND_PORT:-5173}
FRONTEND_URL=${FRONTEND_URL:-"http://localhost:${FRONTEND_PORT}"}

LOG_DIR=${LOG_DIR:-"./logs"}
WAIT_TIMEOUT=${WAIT_TIMEOUT:-60}
OPEN_CMD=${OPEN_CMD:-"open"} # macOS default; falls back to xdg-open

pids=()

info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
err() { echo "[ERROR] $*" >&2; }

cleanup() {
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      info "Stopping process $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

ensure_dir() {
  local dir=$1
  if [[ ! -d "$dir" ]]; then
    err "Directory '$dir' not found. Override BACKEND_DIR/FRONTEND_DIR as needed."
    exit 1
  fi
}

start_service() {
  local name=$1 cmd=$2 dir=$3 logfile=$4
  info "Starting $name: (cd $dir && $cmd)"
  (cd "$dir" && eval "$cmd") >"$logfile" 2>&1 &
  local pid=$!
  pids+=("$pid")
  info "$name started (pid $pid). Logs: $logfile"
}

wait_for_url() {
  local name=$1 url=$2
  local elapsed=0
  until curl -fsS --max-time 2 "$url" >/dev/null 2>&1; do
    if (( elapsed >= WAIT_TIMEOUT )); then
      err "$name did not become ready at $url within ${WAIT_TIMEOUT}s"
      return 1
    fi
    sleep 1
    ((elapsed++))
  done
  info "$name is responding at $url"
}

check_port() {
  local port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$port" >/dev/null 2>&1
  else
    python - <<PY >/dev/null 2>&1
import socket, sys
s = socket.socket()
try:
    s.settimeout(1)
    s.connect(("127.0.0.1", int(sys.argv[1])))
    sys.exit(0)
except Exception:
    sys.exit(1)
finally:
    s.close()
PY
  fi
}

wait_for_port() {
  local name=$1 port=$2 pid=$3
  local elapsed=0
  until check_port "$port"; do
    # Check if the process is still alive
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      err "$name process (pid $pid) died before opening port $port"
      err "Check logs at $LOG_DIR for details"
      return 1
    fi
    if (( elapsed >= WAIT_TIMEOUT )); then
      err "$name did not open port $port within ${WAIT_TIMEOUT}s"
      return 1
    fi
    sleep 1
    ((elapsed++))
  done
  info "$name is listening on port $port"
}

kill_port() {
  local port=$1
  local name=$2
  if check_port "$port"; then
    info "Found existing process on port $port, killing it..."
    # Find and kill processes using this port
    local pids_found=$(lsof -ti tcp:$port 2>/dev/null || true)
    if [[ -n "$pids_found" ]]; then
      echo "$pids_found" | xargs kill -9 2>/dev/null || true
      sleep 1
      if check_port "$port"; then
        warn "$name port $port still busy after kill attempt"
      else
        info "Successfully killed processes on port $port"
      fi
    fi
  fi
}

open_browser() {
  local url=$1
  if command -v "$OPEN_CMD" >/dev/null 2>&1; then
    "$OPEN_CMD" "$url" >/dev/null 2>&1 &
    info "Opened $url in browser via $OPEN_CMD"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
    info "Opened $url in browser via xdg-open"
  else
    warn "No browser open command found. Please open $url manually."
  fi
}

main() {
  mkdir -p "$LOG_DIR"

  ensure_dir "$BACKEND_DIR"
  ensure_dir "$FRONTEND_DIR"

  # Kill existing processes on both ports for fresh start
  kill_port "$BACKEND_PORT" "Backend"
  kill_port "$FRONTEND_PORT" "Frontend"

  # Backend
  start_service "backend" "$BACKEND_CMD" "$BACKEND_DIR" "$LOG_DIR/backend.log"
  local backend_pid="${pids[-1]}"
  wait_for_port "Backend" "$BACKEND_PORT" "$backend_pid"

  # Frontend
  start_service "frontend" "$FRONTEND_CMD" "$FRONTEND_DIR" "$LOG_DIR/frontend.log"
  local frontend_pid="${pids[-1]}"
  wait_for_port "Frontend" "$FRONTEND_PORT" "$frontend_pid"

  open_browser "$FRONTEND_URL"
  info "Both services running. Press Ctrl+C to stop."
  wait
}

main "$@"








