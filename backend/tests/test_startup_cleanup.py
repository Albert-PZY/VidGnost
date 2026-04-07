from pathlib import Path

import app.services.startup_cleanup as startup_cleanup
import pytest
from app.services.startup_cleanup import cleanup_temp_dir_once


def test_cleanup_temp_dir_once_removes_stale_entries(tmp_path: Path) -> None:
    temp_dir = tmp_path / "tmp"
    stale_task_dir = temp_dir / "task-a"
    stale_task_dir.mkdir(parents=True)
    (stale_task_dir / "audio.wav").write_text("wav-data", encoding="utf-8")
    stale_file = temp_dir / "stale.tmp"
    stale_file.write_text("temp", encoding="utf-8")

    report = cleanup_temp_dir_once(temp_dir)

    assert report.scanned_count == 2
    assert report.removed_count == 2
    assert report.failed_entries == []
    assert temp_dir.exists()
    assert list(temp_dir.iterdir()) == []


def test_cleanup_temp_dir_once_creates_missing_root(tmp_path: Path) -> None:
    temp_dir = tmp_path / "not-created-yet"

    report = cleanup_temp_dir_once(temp_dir)

    assert temp_dir.exists()
    assert report.scanned_count == 0
    assert report.removed_count == 0
    assert report.failed_entries == []


def test_cleanup_temp_dir_once_collects_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    temp_dir = tmp_path / "tmp"
    target_dir = temp_dir / "task-b"
    target_dir.mkdir(parents=True)

    original_remove = startup_cleanup._remove_entry

    def remove_with_failure(entry: Path) -> None:
        if entry.name == "task-b":
            raise PermissionError("denied")
        original_remove(entry)

    monkeypatch.setattr(startup_cleanup, "_remove_entry", remove_with_failure)

    report = cleanup_temp_dir_once(temp_dir)

    assert report.scanned_count == 1
    assert report.removed_count == 0
    assert len(report.failed_entries) == 1
    assert "task-b" in report.failed_entries[0]
