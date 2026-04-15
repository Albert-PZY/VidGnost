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

remove_workspace_item "${ROOT_DIR}/backend-ts/dist"
remove_workspace_item "${ROOT_DIR}/backend-ts/coverage"
remove_workspace_item "${ROOT_DIR}/frontend/.vite"
remove_workspace_item "${ROOT_DIR}/frontend/node_modules/.vite"
remove_workspace_item "${ROOT_DIR}/frontend/dist"
remove_workspace_item "${ROOT_DIR}/frontend/coverage"
remove_workspace_item "${ROOT_DIR}/packages/contracts/dist"
remove_workspace_item "${ROOT_DIR}/packages/contracts/coverage"
remove_workspace_item "${ROOT_DIR}/packages/shared/dist"
remove_workspace_item "${ROOT_DIR}/packages/shared/coverage"
remove_workspace_item "${ROOT_DIR}/.turbo"
remove_workspace_item "${ROOT_DIR}/.cache"
