from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
TEXT_POLICY_SCRIPT = REPO_ROOT / "scripts" / "git-hooks" / "check_text_file_policy.py"

PRETTIER_EXTENSIONS = {
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

PYTHON_SKIP_PREFIXES = ("backend/.venv/",)
PNPM_EXECUTABLE = "pnpm.cmd" if sys.platform == "win32" else "pnpm"
POWERSHELL_EXECUTABLE = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
PRETTIER_BATCH_SIZE = 40
RUFF_BATCH_SIZE = 80


def _run(command: list[str], *, cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _run_capture(command: list[str], *, cwd: Path) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    return result.stdout


def _read_utf8(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def _write_utf8_lf(path: str, content: str) -> None:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    resolved_path = str((REPO_ROOT / path).resolve())

    if sys.platform == "win32":
        escaped_path = resolved_path.replace("'", "''")
        command = [
            POWERSHELL_EXECUTABLE,
            "-NoProfile",
            "-Command",
            f"$path = '{escaped_path}'; "
            "$tmp = \"$path.codex-tmp\"; "
            "$content = [Console]::In.ReadToEnd(); "
            "$content = $content -replace \"`r`n\", \"`n\" -replace \"`r\", \"`n\"; "
            "$utf8NoBom = New-Object System.Text.UTF8Encoding($false); "
            "[System.IO.File]::WriteAllText($tmp, $content, $utf8NoBom); "
            "Move-Item -LiteralPath $tmp -Destination $path -Force",
        ]
        for attempt in range(6):
            try:
                subprocess.run(command, input=normalized, text=True, check=True)
                return
            except subprocess.CalledProcessError:
                if attempt == 5:
                    raise
                time.sleep(0.2 * (attempt + 1))
        return

    with open(resolved_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(normalized)


def _git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return [item for item in result.stdout.decode("utf-8").split("\x00") if item]


def _is_prettier_target(path: str) -> bool:
    normalized = Path(path).as_posix()
    suffix = Path(normalized).suffix.lower()

    if normalized.startswith("frontend/"):
        if normalized.startswith(("frontend/src/", "frontend/e2e/")):
            return suffix in PRETTIER_EXTENSIONS
        if normalized == "frontend/index.html":
            return suffix == ".html"
        if normalized.startswith(
            ("frontend/node_modules/", "frontend/dist/", "frontend/test-results/", "frontend/coverage/", "frontend/public/")
        ):
            return False
        return False

    return False


def _collect_prettier_targets() -> list[str]:
    return [path for path in _git_ls_files() if _is_prettier_target(path)]


def _collect_python_targets() -> list[str]:
    targets: list[str] = []
    for path in _git_ls_files():
        normalized = Path(path).as_posix()
        if any(normalized.startswith(prefix) for prefix in PYTHON_SKIP_PREFIXES):
            continue
        if Path(normalized).suffix.lower() != ".py":
            continue
        targets.append(normalized)
    return targets


def _run_text_policy_check(*, fix: bool) -> None:
    command = [sys.executable, str(TEXT_POLICY_SCRIPT), "--mode", "tracked"]
    if fix:
        command.append("--fix")
    _run(command, cwd=REPO_ROOT)


def _run_prettier(*, write: bool, targets: list[str]) -> None:
    if not targets:
        print("[repository-style] No Prettier targets found.")
        return
    if write:
        for target in targets:
            relative_path = str(Path("..") / Path(target)).replace("\\", "/")
            source = _read_utf8(target)
            command = [
                PNPM_EXECUTABLE,
                "exec",
                "prettier",
                "--ignore-path",
                "../.prettierignore",
                "--stdin-filepath",
                relative_path,
            ]
            formatted = subprocess.run(
                command,
                cwd=FRONTEND_DIR,
                input=source,
                text=True,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            ).stdout
            _write_utf8_lf(target, formatted)
        return

    for batch in _chunked(targets, PRETTIER_BATCH_SIZE):
        command = [
            PNPM_EXECUTABLE,
            "exec",
            "prettier",
            "--ignore-path",
            "../.prettierignore",
        ]
        command.append("--write" if write else "--check")
        command.extend([str(Path("..") / Path(path)).replace("\\", "/") for path in batch])
        _run(command, cwd=FRONTEND_DIR)


def _run_ruff(*, format_write: bool, python_targets: list[str]) -> None:
    if not python_targets:
        print("[repository-style] No Ruff targets found.")
        return

    if format_write:
        for target in python_targets:
            source = _read_utf8(target)
            stdin_filename = str(Path(target)).replace("\\", "/")
            fixed = subprocess.run(
                ["uv", "run", "ruff", "check", "--fix-only", "--stdin-filename", stdin_filename, "-"],
                cwd=BACKEND_DIR,
                input=source,
                text=True,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            ).stdout
            formatted = subprocess.run(
                ["uv", "run", "ruff", "format", "--stdin-filename", stdin_filename, "-"],
                cwd=BACKEND_DIR,
                input=fixed or source,
                text=True,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            ).stdout
            _write_utf8_lf(target, formatted)
        return

    backend_relative_targets = [str(Path("..") / Path(path)) for path in python_targets]
    for batch in _chunked(backend_relative_targets, RUFF_BATCH_SIZE):
        check_command = ["uv", "run", "ruff", "check"]
        if format_write:
            check_command.append("--fix")
        check_command.extend(batch)
        _run(check_command, cwd=BACKEND_DIR)

    for batch in _chunked(backend_relative_targets, RUFF_BATCH_SIZE):
        format_command = ["uv", "run", "ruff", "format"]
        if not format_write:
            format_command.append("--check")
        format_command.extend(batch)
        _run(format_command, cwd=BACKEND_DIR)


def main() -> int:
    parser = argparse.ArgumentParser(description="Repository-wide style and formatting helper.")
    parser.add_argument("mode", choices=("check", "format"), help="Run style checks or rewrite files.")
    args = parser.parse_args()

    write = args.mode == "format"
    prettier_targets = _collect_prettier_targets()
    python_targets = _collect_python_targets()

    _run_text_policy_check(fix=write)
    _run_prettier(write=write, targets=prettier_targets)
    _run_ruff(format_write=write, python_targets=python_targets)
    return 0


if __name__ == "__main__":
    sys.exit(main())
