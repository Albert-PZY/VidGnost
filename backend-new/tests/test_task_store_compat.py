from __future__ import annotations

from pathlib import Path

import orjson

from app.services.task_store import TaskStore


def test_task_store_reads_legacy_record_numeric_strings(tmp_path: Path) -> None:
    store = TaskStore(str(tmp_path / "storage"))
    records_dir = Path(tmp_path / "storage" / "tasks" / "records")
    records_dir.mkdir(parents=True, exist_ok=True)
    task_id = "legacy-task-1"
    payload = {
        "task_id": task_id,
        "source": "bilibili",
        "url": "https://www.bilibili.com/video/BV1xxxx",
        "status": "completed",
        "progress": "100.0",
        "artifact_total_bytes": "12345.9",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    (records_dir / f"{task_id}.json").write_bytes(orjson.dumps(payload))

    rows = store.list_all()
    assert len(rows) == 1
    record = rows[0]
    assert record.id == task_id
    assert record.source_type == "bilibili"
    assert record.source_input == "https://www.bilibili.com/video/BV1xxxx"
    assert record.progress == 100
    assert record.artifact_total_bytes == 12345


def test_task_store_fallbacks_to_filename_when_record_id_missing(tmp_path: Path) -> None:
    store = TaskStore(str(tmp_path / "storage"))
    records_dir = Path(tmp_path / "storage" / "tasks" / "records")
    records_dir.mkdir(parents=True, exist_ok=True)
    file_name = "legacy-task-no-id"
    payload = {
        "source_type": "local_file",
        "source_input": "F:/videos/demo.mp4",
        "status": "failed",
        "progress": 100,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    (records_dir / f"{file_name}.json").write_bytes(orjson.dumps(payload))

    rows = store.list_all()
    assert len(rows) == 1
    assert rows[0].id == file_name
