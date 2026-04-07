from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

UTF8_BOM = b"\xef\xbb\xbf"
REPO_ROOT = Path(__file__).resolve().parents[2]

TEXT_SUFFIXES = {
    ".cjs",
    ".conf",
    ".css",
    ".csv",
    ".env",
    ".example",
    ".gitignore",
    ".gitattributes",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsonl",
    ".jsx",
    ".md",
    ".mjs",
    ".npmrc",
    ".ps1",
    ".py",
    ".sh",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

TEXT_FILENAMES = {
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    ".npmignore",
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
}

SKIP_PREFIXES = (
    "backend/.venv/",
    "frontend/dist/",
    "frontend/node_modules/",
)

SKIP_PATHS = {
    "backend/storage/config.toml",
    "backend/storage/model_config.json",
}


def _run_git(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


def _normalize_repo_path(path: str | Path) -> str:
    normalized = Path(path).as_posix()
    if normalized.startswith("./"):
        return normalized[2:]
    return normalized


def _is_target_text_file(path: str) -> bool:
    normalized = _normalize_repo_path(path)
    if any(normalized.startswith(prefix) for prefix in SKIP_PREFIXES):
        return False
    if normalized in SKIP_PATHS:
        return False

    if normalized.startswith(".githooks/"):
        return True

    name = Path(normalized).name
    suffix = Path(normalized).suffix.lower()
    return name in TEXT_FILENAMES or suffix in TEXT_SUFFIXES


def _list_staged_paths() -> list[str]:
    result = _run_git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    return [item for item in result.stdout.decode("utf-8").split("\x00") if item]


def _list_tracked_paths() -> list[str]:
    result = _run_git("ls-files", "-z")
    return [item for item in result.stdout.decode("utf-8").split("\x00") if item]


def _read_index_blob(path: str) -> bytes:
    result = _run_git("show", f":{_normalize_repo_path(path)}")
    return result.stdout


def _read_worktree_file(path: str) -> bytes:
    return (REPO_ROOT / path).read_bytes()


def _normalize_payload(payload: bytes) -> bytes:
    text = payload.decode("utf-8-sig")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    return normalized.encode("utf-8")


def _write_worktree_file(path: str, payload: bytes) -> None:
    (REPO_ROOT / path).write_bytes(payload)


def _validate_bytes(path: str, payload: bytes) -> list[str]:
    errors: list[str] = []

    if payload.startswith(UTF8_BOM):
        errors.append("contains UTF-8 BOM")

    try:
        payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        errors.append(f"is not valid UTF-8 ({exc})")
        return errors

    if b"\r\n" in payload or b"\r" in payload:
        errors.append("contains CRLF/CR line endings; expected LF only")

    if payload and not payload.endswith(b"\n"):
        errors.append("is missing a trailing newline at EOF")

    return errors


def _collect_targets(mode: str, files: list[str]) -> list[str]:
    if mode == "staged":
        return [path for path in _list_staged_paths() if _is_target_text_file(path)]
    if mode == "tracked":
        return [path for path in _list_tracked_paths() if _is_target_text_file(path)]
    if mode == "files":
        normalized = [_normalize_repo_path(path) for path in files]
        return [path for path in normalized if _is_target_text_file(path)]
    raise ValueError(f"Unsupported mode: {mode}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enforce repository text-file policy: UTF-8 without BOM, LF line endings, trailing newline."
    )
    parser.add_argument(
        "--mode",
        choices=("staged", "tracked", "files"),
        required=True,
        help="Validation source: staged index, full tracked index, or explicit working-tree files.",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Normalize working-tree files in-place. Supported only for tracked/files modes.",
    )
    parser.add_argument("files", nargs="*", help="Explicit file paths when --mode=files.")
    args = parser.parse_args()

    if args.mode == "files" and not args.files:
        parser.error("--mode=files requires at least one file path")
    if args.fix and args.mode == "staged":
        parser.error("--fix is not supported with --mode=staged")

    targets = _collect_targets(args.mode, args.files)
    if not targets:
        print("[format-guard] No matching text files to validate.")
        return 0

    violations: list[tuple[str, list[str]]] = []
    fixed_count = 0
    for path in targets:
        try:
            use_worktree = args.mode in {"files", "tracked"}
            payload = _read_worktree_file(path) if use_worktree else _read_index_blob(path)
        except FileNotFoundError:
            violations.append((path, ["file does not exist in working tree"]))
            continue
        except subprocess.CalledProcessError as exc:
            details = (
                exc.stderr.decode("utf-8", errors="replace").strip() or "unable to read git blob"
            )
            violations.append((path, [details]))
            continue

        errors = _validate_bytes(path, payload)
        if errors:
            if args.fix:
                try:
                    normalized_payload = _normalize_payload(payload)
                except UnicodeDecodeError as exc:
                    violations.append((path, [f"is not valid UTF-8 ({exc})"]))
                    continue
                _write_worktree_file(path, normalized_payload)
                fixed_count += 1
                payload = normalized_payload
                errors = _validate_bytes(path, payload)
            violations.append((path, errors))

    if args.fix:
        violations = [(path, errors) for path, errors in violations if errors]

    if not violations:
        suffix = f", fixed {fixed_count}" if args.fix else ""
        print(f"[format-guard] OK ({len(targets)} files{suffix})")
        return 0

    print("[format-guard] FAILED")
    for path, errors in violations:
        print(f"- {path}")
        for error in errors:
            print(f"  - {error}")

    print()
    print("Expected policy: UTF-8 without BOM, LF line endings, trailing newline at EOF.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
