from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import orjson


def build_task_artifact_index(
    *,
    task_id: str,
    transcript_text: str | None,
    transcript_segments_json: str | None,
    summary_markdown: str | None,
    notes_markdown: str | None,
    mindmap_markdown: str | None,
    storage_dir: str | None = None,
) -> tuple[str, int]:
    updated_at = datetime.now(timezone.utc).isoformat()
    entries: list[dict[str, object]] = []
    total_bytes = 0

    def append_entry(key: str, filename: str, value: str | None) -> None:
        nonlocal total_bytes
        if value is None:
            return
        content = value.encode("utf-8")
        size_bytes = len(content)
        total_bytes += size_bytes
        entries.append(
            {
                "key": key,
                "logical_path": f"db://task/{task_id}/{filename}",
                "size_bytes": size_bytes,
                "updated_at": updated_at,
                "source": "db",
            }
        )

    append_entry("transcript_text", "transcript.txt", transcript_text)
    append_entry("transcript_segments", "transcript-segments.json", transcript_segments_json)
    append_entry("summary_markdown", "summary.md", summary_markdown)
    append_entry("notes_markdown", "notes.md", notes_markdown)
    append_entry("mindmap_markdown", "mindmap.md", mindmap_markdown)
    if storage_dir:
        stage_root = Path(storage_dir) / "tasks" / "stage-artifacts" / task_id
        if stage_root.exists() and stage_root.is_dir():
            for path in sorted(item for item in stage_root.rglob("*") if item.is_file()):
                relative = path.relative_to(stage_root).as_posix()
                size_bytes = int(path.stat().st_size)
                total_bytes += size_bytes
                updated = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
                entries.append(
                    {
                        "key": f"stage_artifact:{relative}",
                        "logical_path": f"stage://task/{task_id}/{relative}",
                        "size_bytes": size_bytes,
                        "updated_at": updated,
                        "source": "stage",
                    }
                )

    payload = orjson.dumps(entries).decode("utf-8")
    return payload, total_bytes


def parse_task_artifact_index(raw: str | None) -> list[dict[str, object]]:
    if not raw:
        return []
    try:
        payload = orjson.loads(raw)
    except orjson.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    items: list[dict[str, object]] = []
    for item in payload:
        if isinstance(item, dict):
            items.append(item)
    return items
