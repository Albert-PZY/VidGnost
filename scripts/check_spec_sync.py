#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath

CODE_PREFIXES = ("backend/", "frontend/", "scripts/", ".githooks/")
IGNORED_PREFIXES = ("backend/storage/", "frontend/dist/")
ROOT_CODE_FILES = {
    "start-all.ps1",
    "start-all.sh",
}
DOC_ONLY_SUFFIXES = {
    ".md",
    ".txt",
}
SPEC_PREFIX = "docs/openspec/"


def normalize_path(path: str) -> str:
    return PurePosixPath(path.replace("\\", "/")).as_posix()


def list_staged_paths() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        check=True,
        capture_output=True,
    )
    return [normalize_path(path) for path in result.stdout.decode("utf-8", errors="ignore").split("\0") if path]


def is_spec_path(path: str) -> bool:
    return path.startswith(SPEC_PREFIX)


def is_code_path(path: str) -> bool:
    if any(path.startswith(prefix) for prefix in IGNORED_PREFIXES):
        return False
    if path in ROOT_CODE_FILES:
        return True
    if path.startswith(".githooks/"):
        return True
    if not any(path.startswith(prefix) for prefix in CODE_PREFIXES):
        return False
    return PurePosixPath(path).suffix.lower() not in DOC_ONLY_SUFFIXES


def main() -> int:
    try:
        changed_paths = [normalize_path(path) for path in sys.argv[1:]] or list_staged_paths()
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="ignore") if isinstance(exc.stderr, bytes) else str(exc.stderr)
        sys.stderr.write(stderr)
        return 1

    code_paths = sorted({path for path in changed_paths if is_code_path(path)})
    if not code_paths:
        return 0

    spec_paths = sorted({path for path in changed_paths if is_spec_path(path)})
    if spec_paths:
        return 0

    sys.stderr.write("检测到项目代码变更，但当前提交未包含 OpenSpec 同步更新，已阻止本次提交/校验。\n")
    sys.stderr.write("以下代码路径触发了 spec 同步约束：\n")
    for path in code_paths:
        sys.stderr.write(f"- {path}\n")
    sys.stderr.write("请至少同步更新以下目录中的受影响 spec：\n")
    sys.stderr.write(f"- {SPEC_PREFIX}changes/build-lightweight-v2/specs/\n")
    sys.stderr.write(f"- {SPEC_PREFIX}specs/\n")
    sys.stderr.write("如果实现细节已被现有 spec 完整覆盖，请在本次交付中补充对应 OpenSpec 文档以体现已完成的核对。\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
