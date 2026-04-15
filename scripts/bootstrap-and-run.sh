#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/apps/desktop"
BACKEND_PORT=8666
FRONTEND_PORT=6221
STORAGE_DIR="${ROOT_DIR}/storage"
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
    exit 1
  fi
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

require_cmd pnpm
require_cmd node

mkdir -p "${STORAGE_DIR}"
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-${PNPM_REGISTRY_MIRROR}}"
export ELECTRON_MIRROR
pnpm config set registry "${PNPM_REGISTRY_MIRROR}" >/dev/null 2>&1 || true
echo "[setup] Mirrors configured (pnpm: ${PNPM_REGISTRY_MIRROR}, electron: ${ELECTRON_MIRROR})."

ensure_port_free "${BACKEND_PORT}" "backend" "127.0.0.1"
ensure_port_free "${FRONTEND_PORT}" "frontend" "127.0.0.1"

echo "[setup] Install workspace dependencies..."
(cd "${ROOT_DIR}" && pnpm install)

echo "[run] Starting backend at http://127.0.0.1:${BACKEND_PORT}/api ..."
(cd "${ROOT_DIR}" && VIDGNOST_API_HOST="127.0.0.1" VIDGNOST_API_PORT="${BACKEND_PORT}" VIDGNOST_STORAGE_DIR="${STORAGE_DIR}" pnpm --filter @vidgnost/api dev) &
BACKEND_PID=$!
wait_port_ready "${BACKEND_PORT}" "backend"

stop_existing_electron_for_project
echo "[run] Starting frontend in Electron mode ..."
(cd "${ROOT_DIR}" && VITE_API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}/api" VITE_DEV_SERVER_URL="http://127.0.0.1:${FRONTEND_PORT}" pnpm --filter @vidgnost/desktop desktop:dev) &
FRONTEND_PID=$!
wait_electron_ready 45

BACKEND_SERVICE_PIDS="$(listening_port_pids "${BACKEND_PORT}")"
FRONTEND_SERVICE_PIDS="$(electron_pids_for_project)"
echo "[ready] Backend launcher PID: ${BACKEND_PID}, Frontend launcher PID: ${FRONTEND_PID}"
echo "[ready] Backend service PID(s): ${BACKEND_SERVICE_PIDS}"
echo "[ready] Frontend service PID(s): ${FRONTEND_SERVICE_PIDS}"
echo "[ready] Frontend mode: electron"
echo "[ready] Backend API URL: http://127.0.0.1:${BACKEND_PORT}/api"
echo "[ready] Frontend dev server URL: http://127.0.0.1:${FRONTEND_PORT}"
echo "[ready] Press Ctrl+C to stop both processes."

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
