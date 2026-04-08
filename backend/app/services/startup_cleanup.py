from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class StartupTempCleanupReport:
    scanned_count: int = 0
    removed_count: int = 0
    failed_entries: list[str] = field(default_factory=list)


def cleanup_temp_dir_once(temp_dir: str | Path) -> StartupTempCleanupReport:
    root = Path(temp_dir)
    root.mkdir(parents=True, exist_ok=True)

    report = StartupTempCleanupReport()
    for entry in root.iterdir():
        report.scanned_count += 1
        try:
            _remove_entry(entry)
            report.removed_count += 1
        except Exception as exc:  # noqa: BLE001
            report.failed_entries.append(f"{entry.name}: {type(exc).__name__}: {exc}")
    return report


def _remove_entry(entry: Path) -> None:
    if entry.is_dir() and not entry.is_symlink():
        shutil.rmtree(entry)
        return
    entry.unlink(missing_ok=True)
