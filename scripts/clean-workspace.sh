#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

remove_workspace_item() {
  local target="$1"
  if [[ ! -e "${target}" ]]; then
    return
  fi

  local resolved_target
  resolved_target="$(cd "$(dirname "${target}")" && pwd)/$(basename "${target}")"
  if [[ "${resolved_target}" != "${ROOT_DIR}"* ]]; then
    echo "[clean] Refusing to delete path outside workspace: ${resolved_target}" >&2
    exit 1
  fi

  rm -rf "${resolved_target}"
  echo "[clean] Removed ${resolved_target}"
}

while IFS= read -r log_file; do
  [[ -z "${log_file}" ]] && continue
  remove_workspace_item "${log_file}"
done < <(find "${ROOT_DIR}" -maxdepth 1 -type f -name '*.log' -print)

remove_workspace_item "${ROOT_DIR}/backend/.mypy_cache"
remove_workspace_item "${ROOT_DIR}/backend/.pytest_cache"
remove_workspace_item "${ROOT_DIR}/backend/.ruff_cache"
remove_workspace_item "${ROOT_DIR}/backend/app/__pycache__"
remove_workspace_item "${ROOT_DIR}/backend/app/api/__pycache__"
remove_workspace_item "${ROOT_DIR}/backend/app/services/__pycache__"
remove_workspace_item "${ROOT_DIR}/frontend/.vite"
remove_workspace_item "${ROOT_DIR}/frontend/node_modules/.vite"
remove_workspace_item "${ROOT_DIR}/frontend/dist"
