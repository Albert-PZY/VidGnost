#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_PORT=8666
FRONTEND_PORT=6221
PINNED_PYTHON_VERSION="3.12"
UV_DEFAULT_INDEX_MIRROR="${UV_DEFAULT_INDEX_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
PNPM_REGISTRY_MIRROR="${PNPM_REGISTRY_MIRROR:-https://registry.npmmirror.com}"
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "[error] Missing command: ${name}"
    exit 1
  fi
}

listening_port_pids() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti TCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [[ -z "${pids}" ]] && command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :${port}" 2>/dev/null | awk -F'pid=' 'NR>1 {split($2, a, ","); if (a[1] != "") print a[1]}' | sort -u || true)"
  fi
  if [[ -z "${pids}" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "${port}" 2>/dev/null || true)"
  fi
  echo "${pids}"
}

port_owner_pids() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti TCP:"${port}" 2>/dev/null || true)"
  fi
  if [[ -z "${pids}" ]] && command -v ss >/dev/null 2>&1; then
    pids="$(ss -Htanp "( sport = :${port} )" 2>/dev/null | awk -F'pid=' '{split($2, a, ","); if (a[1] != "") print a[1]}' | sort -u || true)"
  fi
  if [[ -z "${pids}" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "${port}" 2>/dev/null || true)"
  fi
  echo "${pids}"
}

test_port_bindable() {
  local port="$1"
  local host="${2:-127.0.0.1}"
  node -e "const net = require('node:net'); const port = Number(process.argv[1]); const host = process.argv[2]; const server = net.createServer(); server.once('error', () => process.exit(1)); server.listen({ port, host, exclusive: true }, () => server.close(() => process.exit(0)));" "${port}" "${host}" >/dev/null 2>&1
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  local bind_host="$3"
  local attempt=1
  while (( attempt <= 6 )); do
    if test_port_bindable "${port}" "${bind_host}"; then
      if (( attempt == 1 )); then
        echo "[setup] Port ${port} (${label}) is free."
      else
        echo "[setup] Port ${port} (${label}) has been released."
      fi
      return
    fi

    local pids
    pids="$(port_owner_pids "${port}")"
    if [[ -z "${pids//[[:space:]]/}" ]]; then
      echo "[warn] Port ${port} (${label}) is unavailable, but no PID was resolved. Waiting..."
      sleep 0.4
      ((attempt++))
      continue
    fi

    if (( attempt == 1 )); then
      echo "[setup] Port ${port} (${label}) is occupied. Force stopping PID(s): ${pids}"
    else
      echo "[warn] Port ${port} (${label}) still occupied. Retry ${attempt}/6: ${pids}"
    fi

    local pid
    for pid in ${pids}; do
      if [[ "${pid}" =~ ^[0-9]+$ ]]; then
        kill -9 "${pid}" >/dev/null 2>&1 || true
      fi
    done
    sleep 0.4
    ((attempt++))
  done

  if ! test_port_bindable "${port}" "${bind_host}"; then
    local remaining
    remaining="$(port_owner_pids "${port}")"
    if [[ -n "${remaining//[[:space:]]/}" ]]; then
      echo "[error] Port ${port} (${label}) is still occupied: ${remaining}"
    else
      echo "[error] Port ${port} (${label}) is still unavailable and no owning PID could be resolved."
    fi
    return 1
  fi

  return 0
}

wait_port_ready() {
  local port="$1"
  local label="$2"
  local timeout_seconds="${3:-25}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local pids
    pids="$(listening_port_pids "${port}")"
    if [[ -n "${pids//[[:space:]]/}" ]]; then
      echo "[ready] Port ${port} (${label}) is listening. PID(s): ${pids}"
      return
    fi
    sleep 0.4
  done

  echo "[error] Port ${port} (${label}) did not become ready within ${timeout_seconds}s"
  exit 1
}

electron_pids_for_project() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "electron.*${FRONTEND_DIR}" 2>/dev/null || true
    return
  fi
  ps -eo pid=,args= | awk -v key="${FRONTEND_DIR}" 'index($0, "electron") && index($0, key) { print $1 }'
}

stop_existing_electron_for_project() {
  local pids
  pids="$(electron_pids_for_project)"
  if [[ -z "${pids//[[:space:]]/}" ]]; then
    return
  fi
  echo "[setup] Cleaning stale Electron process(es): ${pids}"
  local pid
  for pid in ${pids}; do
    if [[ "${pid}" =~ ^[0-9]+$ ]]; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

wait_electron_ready() {
  local timeout_seconds="${1:-45}"
  local deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    if ! kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
      echo "[error] Frontend launcher exited before Electron app became ready."
      exit 1
    fi

    local pids
    pids="$(electron_pids_for_project)"
    if [[ -n "${pids//[[:space:]]/}" ]]; then
      echo "[ready] Electron app process PID(s): ${pids}"
      return
    fi
    sleep 0.4
  done
  echo "[error] Electron app did not become ready within ${timeout_seconds}s"
  exit 1
}

cleanup() {
  local exit_code=$?
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  wait || true
  exit "${exit_code}"
}

trap cleanup INT TERM EXIT

require_cmd uv
require_cmd pnpm
require_cmd node

export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-${PNPM_REGISTRY_MIRROR}}"
export ELECTRON_MIRROR
pnpm config set registry "${PNPM_REGISTRY_MIRROR}" >/dev/null 2>&1 || true
uv_index_display="${UV_DEFAULT_INDEX_MIRROR}"
echo "[setup] Mirrors configured (uv index-url: ${uv_index_display}, pnpm: ${PNPM_REGISTRY_MIRROR}, electron: ${ELECTRON_MIRROR})."

ensure_port_free "${BACKEND_PORT}" "backend" "0.0.0.0"
ensure_port_free "${FRONTEND_PORT}" "frontend" "127.0.0.1"
SELECTED_BACKEND_PORT="${BACKEND_PORT}"
SELECTED_FRONTEND_PORT="${FRONTEND_PORT}"

echo "[setup] Sync backend dependencies..."
uv_sync_args=(uv sync --python "${PINNED_PYTHON_VERSION}")
uv_sync_args+=(--index-url "${UV_DEFAULT_INDEX_MIRROR}")
(cd "${BACKEND_DIR}" && "${uv_sync_args[@]}")

echo "[setup] Install frontend dependencies..."
(cd "${FRONTEND_DIR}" && pnpm install)

echo "[run] Starting backend at http://127.0.0.1:${SELECTED_BACKEND_PORT} ..."
(cd "${BACKEND_DIR}" && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 uv run python -m uvicorn app.main:app --host 0.0.0.0 --port "${SELECTED_BACKEND_PORT}" --reload --reload-dir app --reload-exclude=".venv/*" --reload-exclude="storage/*") &
BACKEND_PID=$!
wait_port_ready "${SELECTED_BACKEND_PORT}" "backend"

stop_existing_electron_for_project
echo "[run] Starting frontend in Electron mode ..."
(cd "${FRONTEND_DIR}" && VITE_API_BASE_URL="http://127.0.0.1:${SELECTED_BACKEND_PORT}/api" VITE_DEV_SERVER_URL="http://127.0.0.1:${SELECTED_FRONTEND_PORT}" pnpm exec concurrently -k -n VITE,ELECTRON -c cyan,green "pnpm dev --host 127.0.0.1 --port ${SELECTED_FRONTEND_PORT}" "pnpm exec wait-on tcp:${SELECTED_FRONTEND_PORT} && electron electron/main.cjs") &
FRONTEND_PID=$!
wait_electron_ready 45

BACKEND_SERVICE_PIDS="$(listening_port_pids "${SELECTED_BACKEND_PORT}")"
FRONTEND_SERVICE_PIDS="$(electron_pids_for_project)"
echo "[ready] Backend launcher PID: ${BACKEND_PID}, Frontend launcher PID: ${FRONTEND_PID}"
echo "[ready] Backend service PID(s): ${BACKEND_SERVICE_PIDS}"
echo "[ready] Frontend service PID(s): ${FRONTEND_SERVICE_PIDS}"
echo "[ready] Frontend mode: electron"
echo "[ready] Backend API URL: http://127.0.0.1:${SELECTED_BACKEND_PORT}/api"
echo "[ready] Frontend dev server URL: http://127.0.0.1:${SELECTED_FRONTEND_PORT}"
echo "[ready] Press Ctrl+C to stop both processes."

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
