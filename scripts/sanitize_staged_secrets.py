#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import sys
from typing import Iterable

AUTO_SANITIZE_PATHS = {"backend/storage/model_config.json"}
PLACEHOLDER_VALUES = {
    "",
    "test-key",
    "your-api-key",
    "YOUR_API_KEY",
    "sk-your-api-key",
    "${OPENAI_API_KEY}",
    "${API_KEY}",
    "REDACTED",
    "<redacted>",
    "***",
}
SECRET_PATTERNS = [
    ("OpenAI key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Bearer token", re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}", re.IGNORECASE)),
]
API_KEY_PATTERN = re.compile(r'(?im)(["\']?api[_-]?key["\']?\s*[:=]\s*["\'])([^"\'\r\n]*)(["\'])')


def run_git(*args: str, input_data: str | bytes | None = None, text: bool = False) -> str | bytes:
    result = subprocess.run(
        ["git", *args],
        input=input_data,
        check=True,
        capture_output=True,
        text=text,
    )
    return result.stdout


def get_staged_paths() -> list[str]:
    raw = run_git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    return [path for path in raw.decode("utf-8", errors="ignore").split("\0") if path]


def get_staged_text(path: str) -> str:
    return run_git("show", f":{path}").decode("utf-8")


def get_index_mode(path: str) -> str:
    line = run_git("ls-files", "-s", "--", path, text=True).strip().splitlines()[0]
    return line.split(maxsplit=3)[0]


def update_index_text(path: str, content: str) -> None:
    blob_id = run_git("hash-object", "-w", "--stdin", input_data=content, text=True).strip()
    mode = get_index_mode(path)
    run_git("update-index", "--cacheinfo", f"{mode},{blob_id},{path}")


def normalize_placeholder(value: str) -> str:
    return value.strip().strip('"\'')


def is_placeholder(value: str) -> bool:
    normalized = normalize_placeholder(value)
    if normalized in PLACEHOLDER_VALUES:
        return True
    if normalized.startswith("${") and normalized.endswith("}"):
        return True
    lowered = normalized.lower()
    if lowered.startswith("your-") or lowered.startswith("example-"):
        return True
    if set(normalized) <= {"*", "x", "X", "-", "_"} and normalized:
        return True
    return False


def looks_like_secret_value(value: str) -> bool:
    normalized = normalize_placeholder(value)
    if is_placeholder(normalized):
        return False
    if len(normalized) < 12:
        return False
    if normalized.startswith(("sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "AKIA")):
        return True
    if any(ch.isalpha() for ch in normalized) and any(ch.isdigit() for ch in normalized):
        return True
    return len(normalized) >= 20 and " " not in normalized


def sanitize_api_keys(text: str) -> tuple[str, bool]:
    changed = False

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        value = match.group(2)
        if not value or is_placeholder(value):
            return match.group(0)
        changed = True
        return f"{match.group(1)}test-key{match.group(3)}"

    sanitized = API_KEY_PATTERN.sub(replace, text)
    return sanitized, changed


def find_secret_hits(path: str, text: str) -> list[str]:
    hits: list[str] = []
    for name, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            hits.append(name)
    for match in API_KEY_PATTERN.finditer(text):
        if looks_like_secret_value(match.group(2)):
            hits.append("API key assignment")
            break
    return hits


def main() -> int:
    try:
        staged_paths = get_staged_paths()
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(exc.stderr.decode("utf-8", errors="ignore") if isinstance(exc.stderr, bytes) else exc.stderr)
        return 1

    offending: list[tuple[str, Iterable[str]]] = []

    for path in staged_paths:
        try:
            text = get_staged_text(path)
        except (subprocess.CalledProcessError, UnicodeDecodeError):
            continue

        if path in AUTO_SANITIZE_PATHS:
            sanitized, changed = sanitize_api_keys(text)
            if changed:
                update_index_text(path, sanitized)
                text = sanitized
                sys.stdout.write(f"[pre-commit] sanitized staged secrets in {path}\n")

        hits = find_secret_hits(path, text)
        if hits:
            offending.append((path, hits))

    if offending:
        sys.stderr.write("检测到未脱敏的敏感信息，已阻止本次提交：\n")
        for path, hits in offending:
            sys.stderr.write(f"- {path}: {', '.join(hits)}\n")
        sys.stderr.write("请先移除敏感信息或使用占位值后重新提交。\n")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
