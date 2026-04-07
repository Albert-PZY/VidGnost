#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
INSTALL_TIMEOUT_SECONDS="${INSTALL_TIMEOUT_SECONDS:-45}"
UV_INSTALLER_MIRROR_BASE_URL="${UV_INSTALLER_MIRROR_BASE_URL:-https://ghproxy.net/https://github.com}"
PNPM_REGISTRY_MIRROR="${PNPM_REGISTRY_MIRROR:-https://registry.npmmirror.com}"
UV_DEFAULT_INDEX_MIRROR="${UV_DEFAULT_INDEX_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
PINNED_PYTHON_VERSION="3.12"

log() {
  echo "[auto-fix] $1"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_seconds}" "$@"
    return $?
  fi
  "$@"
}

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi
  log "uv not found. Installing latest from mirror..."
  if run_with_timeout "${INSTALL_TIMEOUT_SECONDS}" env UV_INSTALLER_GITHUB_BASE_URL="${UV_INSTALLER_MIRROR_BASE_URL}" bash -lc "curl -LsSf https://astral.sh/uv/install.sh | sh"; then
    :
  else
    local mirror_exit_code=$?
    if [[ "${mirror_exit_code}" -eq 124 ]]; then
      log "Mirror uv installer timed out after ${INSTALL_TIMEOUT_SECONDS}s. Falling back to official source..."
    else
      log "Mirror uv installer failed (exit ${mirror_exit_code}). Falling back to official source..."
    fi
    run_with_timeout "${INSTALL_TIMEOUT_SECONDS}" bash -lc "curl -LsSf https://astral.sh/uv/install.sh | sh"
  fi
  if ! command -v uv >/dev/null 2>&1; then
    export PATH="$HOME/.local/bin:$PATH"
  fi
  if ! command -v uv >/dev/null 2>&1; then
    log "Failed to install uv from both mirror and official source."
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi
  if ! command -v corepack >/dev/null 2>&1; then
    log "corepack is unavailable. Cannot auto-install pnpm."
    return
  fi
  log "pnpm not found. Enabling via corepack (mirror first)..."
  corepack enable
  if run_with_timeout "${INSTALL_TIMEOUT_SECONDS}" env COREPACK_NPM_REGISTRY="${PNPM_REGISTRY_MIRROR}" corepack prepare pnpm@latest --activate; then
    :
  else
    local mirror_exit_code=$?
    if [[ "${mirror_exit_code}" -eq 124 ]]; then
      log "Mirror pnpm install timed out after ${INSTALL_TIMEOUT_SECONDS}s. Falling back to official source..."
    else
      log "Mirror pnpm install failed (exit ${mirror_exit_code}). Falling back to official source..."
    fi
    run_with_timeout "${INSTALL_TIMEOUT_SECONDS}" corepack prepare pnpm@latest --activate
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    log "Failed to install pnpm from both mirror and official source."
  fi
}

configure_dependency_mirrors() {
  export UV_DEFAULT_INDEX="${UV_DEFAULT_INDEX:-${UV_DEFAULT_INDEX_MIRROR}}"
  export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-${PNPM_REGISTRY_MIRROR}}"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm config set registry "${PNPM_REGISTRY_MIRROR}" >/dev/null || true
  fi
  uv_index_display="${UV_DEFAULT_INDEX_MIRROR}"
  log "Dependency mirrors configured (uv index-url: ${uv_index_display}, pnpm: ${PNPM_REGISTRY_MIRROR})."
}

repair_backend_venv_if_needed() {
  local venv_dir="${BACKEND_DIR}/.venv"
  if [[ ! -d "${venv_dir}" ]]; then
    return
  fi

  local rebuild_reason=""
  local cfg_home=""
  local cfg_version=""
  if [[ -f "${venv_dir}/pyvenv.cfg" ]]; then
    cfg_home="$(sed -n 's/^[[:space:]]*home[[:space:]]*=[[:space:]]*//p' "${venv_dir}/pyvenv.cfg" | head -n 1 | tr -d '\r')"
    cfg_version="$(sed -n 's/^[[:space:]]*version_info[[:space:]]*=[[:space:]]*//p' "${venv_dir}/pyvenv.cfg" | head -n 1 | tr -d '\r')"
  fi

  if [[ -d "${venv_dir}/Scripts" && ! -x "${venv_dir}/bin/python" ]]; then
    rebuild_reason="detected Windows-style .venv in Linux runtime"
  elif [[ ! -x "${venv_dir}/bin/python" ]]; then
    rebuild_reason="missing ${venv_dir}/bin/python"
  elif [[ -n "${cfg_home}" && "${cfg_home}" =~ ^[A-Za-z]:\\ ]]; then
    rebuild_reason="pyvenv home points to Windows interpreter (${cfg_home})"
  elif [[ -n "${cfg_version}" && ! "${cfg_version}" =~ ^3\.12(\.|$) ]]; then
    rebuild_reason="pyvenv version_info is ${cfg_version} (requires 3.12.x)"
  fi

  if [[ -n "${rebuild_reason}" ]]; then
    log "Rebuilding backend .venv due to compatibility conflict: ${rebuild_reason}"
    rm -rf "${venv_dir}"
  fi
}

attempt_ffmpeg_install() {
  if command -v ffmpeg >/dev/null 2>&1; then
    log "ffmpeg already exists."
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    log "ffmpeg missing and apt-get unavailable. Please install ffmpeg manually."
    return
  fi

  log "ffmpeg missing. Attempting apt-get install..."
  if [[ "${EUID}" -eq 0 ]]; then
    apt-get update && apt-get install -y ffmpeg || log "apt-get install ffmpeg failed. Please install manually."
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y ffmpeg || log "sudo apt-get install ffmpeg failed. Please install manually."
    return
  fi

  log "No root privilege or sudo. Please install ffmpeg manually."
}

ensure_runtime_files() {
  log "Ensuring runtime config files exist..."
  (
    cd "${BACKEND_DIR}" && uv run python - <<'PY'
import asyncio

from app.config import get_settings
from app.services.llm_config_store import LLMConfigStore
from app.services.runtime_config_store import RuntimeConfigStore

settings = get_settings()

async def main():
    llm_store = LLMConfigStore(settings)
    await llm_store.get()
    runtime_store = RuntimeConfigStore(settings)
    await runtime_store.get_whisper()

asyncio.run(main())
print("runtime config files are ready")
PY
  )
}

log "Running cross-platform auto-fix workflow..."
ensure_uv
ensure_pnpm
configure_dependency_mirrors
repair_backend_venv_if_needed

log "Sync backend dependencies..."
uv_sync_args=(uv sync --python "${PINNED_PYTHON_VERSION}")
uv_sync_args+=(--index-url "${UV_DEFAULT_INDEX_MIRROR}")
(cd "${BACKEND_DIR}" && "${uv_sync_args[@]}")

log "Install frontend dependencies..."
(cd "${FRONTEND_DIR}" && pnpm install)

attempt_ffmpeg_install
ensure_runtime_files

log "Auto-fix workflow finished."
