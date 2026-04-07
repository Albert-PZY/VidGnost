from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tomllib
from typing import Iterable

PROTECTED_PATHS = (
    "backend/storage/config.toml",
    "backend/storage/model_config.json",
)

SENSITIVE_KEY_TOKENS = (
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "private_key",
    "access_key",
    "access_token",
    "refresh_token",
    "client_secret",
)

SAFE_PLACEHOLDER_VALUES = {
    "",
    "__SECRET_MASKED__",
    "********",
    "***",
    "<redacted>",
    "<masked>",
    "your-api-key",
    "your_api_key",
    "replace-me",
    "changeme",
    "null",
}

ZERO_SHA = "0" * 40


def _run_git(
    *args: str, check: bool = True, input_text: str | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        input=input_text,
    )


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/").strip()


def _is_sensitive_key(key: str) -> bool:
    candidate = key.strip().lower()
    return any(token in candidate for token in SENSITIVE_KEY_TOKENS)


def _is_safe_placeholder(value: str) -> bool:
    normalized = value.strip()
    if normalized.lower() in SAFE_PLACEHOLDER_VALUES:
        return True
    if normalized.startswith("${") and normalized.endswith("}"):
        return True
    if normalized.startswith("%") and normalized.endswith("%"):
        return True
    if normalized.startswith("<") and normalized.endswith(">"):
        return True
    return False


def _walk_sensitive_values(
    value: object, key_path: tuple[str, ...] = ()
) -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        for key, nested in value.items():
            next_path = (*key_path, str(key))
            yield from _walk_sensitive_values(nested, next_path)
        return

    if isinstance(value, list):
        for index, nested in enumerate(value):
            yield from _walk_sensitive_values(nested, (*key_path, str(index)))
        return

    if not key_path:
        return

    joined_path = ".".join(key_path)
    if not any(_is_sensitive_key(part) for part in key_path):
        return

    if isinstance(value, str):
        if not _is_safe_placeholder(value):
            yield joined_path, "non-empty string secret"
        return

    if value is not None:
        yield joined_path, f"non-string secret value ({type(value).__name__})"


def _parse_blob(path: str, raw_text: str) -> object:
    if path.endswith(".json"):
        return json.loads(raw_text)
    if path.endswith(".toml"):
        return tomllib.loads(raw_text)
    raise ValueError(f"Unsupported protected config format: {path}")


def _validate_blob(path: str, raw_text: str) -> list[tuple[str, str]]:
    parsed = _parse_blob(path, raw_text)
    return list(_walk_sensitive_values(parsed))


def _read_staged_blob(path: str) -> str | None:
    result = _run_git("show", f":{path}", check=False)
    if result.returncode != 0:
        return None
    return result.stdout


def _iter_staged_protected_paths() -> list[str]:
    result = _run_git(
        "diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", *PROTECTED_PATHS
    )
    return [
        _normalize_path(line)
        for line in result.stdout.splitlines()
        if _normalize_path(line) in PROTECTED_PATHS
    ]


def _iter_push_commits(stdin_payload: str) -> list[tuple[str, list[str]]]:
    commits_to_check: list[tuple[str, list[str]]] = []
    for line in stdin_payload.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        local_ref, local_sha, _remote_ref, remote_sha = stripped.split()
        _ = local_ref
        if local_sha == ZERO_SHA:
            continue
        if remote_sha == ZERO_SHA:
            rev_list = _run_git("rev-list", local_sha, "--not", "--remotes").stdout.splitlines()
        else:
            rev_list = _run_git("rev-list", f"{remote_sha}..{local_sha}").stdout.splitlines()
        for commit in rev_list:
            diff_paths = _run_git(
                "diff-tree", "--no-commit-id", "--name-only", "-r", commit, "--", *PROTECTED_PATHS
            ).stdout
            touched = [
                _normalize_path(item)
                for item in diff_paths.splitlines()
                if _normalize_path(item) in PROTECTED_PATHS
            ]
            if touched:
                commits_to_check.append((commit, touched))
    return commits_to_check


def _check_staged() -> int:
    violations: list[str] = []
    for path in _iter_staged_protected_paths():
        raw_text = _read_staged_blob(path)
        if raw_text is None:
            continue
        try:
            hits = _validate_blob(path, raw_text)
        except Exception as exc:  # noqa: BLE001
            violations.append(
                f"{path}: invalid staged config payload ({type(exc).__name__}: {exc})"
            )
            continue
        for key_path, reason in hits:
            violations.append(f"{path} -> {key_path}: {reason}")
    return _emit_violations("commit", violations)


def _check_pre_push(stdin_payload: str) -> int:
    violations: list[str] = []
    for commit, paths in _iter_push_commits(stdin_payload):
        for path in paths:
            result = _run_git("show", f"{commit}:{path}", check=False)
            if result.returncode != 0:
                continue
            try:
                hits = _validate_blob(path, result.stdout)
            except Exception as exc:  # noqa: BLE001
                violations.append(
                    f"{commit[:12]} {path}: invalid committed config payload ({type(exc).__name__}: {exc})"
                )
                continue
            for key_path, reason in hits:
                violations.append(f"{commit[:12]} {path} -> {key_path}: {reason}")
    return _emit_violations("push", violations)


def _emit_violations(stage: str, violations: list[str]) -> int:
    if not violations:
        return 0
    print(
        "[protect-local-config-secrets] blocked "
        f"{stage}: sensitive values detected in protected config files.\n"
        "The hook only inspects staged/outgoing content and does not modify local working-copy values.\n"
        "Please unstage those files, replace secrets with placeholders in the commit content, or avoid pushing them.",
        file=sys.stderr,
    )
    for item in violations:
        print(f"  - {item}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("staged", "pre-push"), required=True)
    args = parser.parse_args()

    if args.mode == "staged":
        return _check_staged()

    stdin_payload = sys.stdin.read()
    return _check_pre_push(stdin_payload)


if __name__ == "__main__":
    raise SystemExit(main())
