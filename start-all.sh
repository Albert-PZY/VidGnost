#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/scripts/bootstrap-and-run.sh"
MODE="${1:-web}"

if [[ ! -f "${TARGET_SCRIPT}" ]]; then
  echo "Missing script: ${TARGET_SCRIPT}" >&2
  exit 1
fi

bash "${TARGET_SCRIPT}" --mode "${MODE}"
