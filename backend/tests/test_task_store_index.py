from __future__ import annotations

from datetime import datetime
from pathlib import Path

import orjson

from app.models import TaskRecord
from app.services.task_store import TaskStore


def _record(task_id: str, *, title: str, source_input: str, updated_at: str) -> TaskRecord:
    ts = datetime.fromisoformat(updated_at)
    return TaskRecord(
        id=task_id,
        source_type="bilibili",
        source_input=source_input,
        title=title,
        status="completed",
        progress=100,
        created_at=ts,
        updated_at=ts,
    )


def test_task_store_list_uses_index_sort_and_keyword_filter(tmp_path: Path) -> None:
    store = TaskStore(str(tmp_path / "storage"))
    store.create(
        _record(
            "task-a",
            title="课程整理",
            source_input="https://www.bilibili.com/video/BV1a",
            updated_at="2026-01-01T00:00:00+00:00",
        )
    )
    store.create(
        _record(
            "task-b",
            title="访谈提炼",
            source_input="https://www.bilibili.com/video/BV1b",
            updated_at="2026-01-02T00:00:00+00:00",
        )
    )
    store.create(
        _record(
            "task-c",
            title="课程回放",
            source_input="https://www.bilibili.com/video/BV1c",
            updated_at="2026-01-03T00:00:00+00:00",
        )
    )

    listing = store.list(q="课程", limit=10, offset=0)
    assert listing.total == 2
    assert [item.id for item in listing.items] == ["task-c", "task-a"]


def test_task_store_list_cleans_stale_index_entries(tmp_path: Path) -> None:
    store = TaskStore(str(tmp_path / "storage"))
    store.create(
        _record(
            "task-a",
            title="A",
            source_input="input-a",
            updated_at="2026-01-01T00:00:00+00:00",
        )
    )
    records_dir = Path(tmp_path / "storage" / "tasks" / "records")
    (records_dir / "task-a.json").unlink(missing_ok=True)

    listing = store.list(limit=20, offset=0)
    assert listing.total == 0
    assert listing.items == []

    index_path = Path(tmp_path / "storage" / "tasks" / "index.json")
    payload = orjson.loads(index_path.read_bytes())
    assert payload.get("items") == []
