from __future__ import annotations

from dataclasses import dataclass

from app.models import TaskRecord, TaskStatus
from app.services.task_artifact_index import build_task_artifact_index
from app.services.task_store import TaskStore

_TERMINAL_STATUSES = {
    TaskStatus.COMPLETED.value,
    TaskStatus.FAILED.value,
    TaskStatus.CANCELLED.value,
}


@dataclass(slots=True)
class TaskHistoryCleanupReport:
    scanned_count: int = 0
    removed_count: int = 0
    removed_total_bytes: int = 0
    kept_total_bytes: int = 0
    max_total_bytes: int = 0
    max_tasks: int = 0


def cleanup_task_history_once(
    task_store: TaskStore,
    *,
    max_total_bytes: int,
    max_tasks: int,
    storage_dir: str | None = None,
) -> TaskHistoryCleanupReport:
    report = TaskHistoryCleanupReport(
        max_total_bytes=max(0, int(max_total_bytes)),
        max_tasks=max(1, int(max_tasks)),
    )
    records = task_store.list_all()
    records.sort(key=lambda item: item.updated_at, reverse=True)
    report.scanned_count = len(records)
    terminal_kept = 0

    for record in records:
        if record.status not in _TERMINAL_STATUSES:
            continue
        if _ensure_artifact_meta(record, storage_dir=storage_dir):
            task_store.replace(record)
        artifact_bytes = max(0, int(record.artifact_total_bytes or 0))
        should_keep = terminal_kept < report.max_tasks and (
            report.kept_total_bytes + artifact_bytes <= report.max_total_bytes or terminal_kept == 0
        )
        if should_keep:
            terminal_kept += 1
            report.kept_total_bytes += artifact_bytes
            continue

        task_store.delete(record.id)
        report.removed_count += 1
        report.removed_total_bytes += artifact_bytes

    return report


def _ensure_artifact_meta(record: TaskRecord, *, storage_dir: str | None = None) -> bool:
    if (record.artifact_total_bytes or 0) > 0 and record.artifact_index_json:
        return False
    index_json, total_bytes = build_task_artifact_index(
        task_id=record.id,
        transcript_text=record.transcript_text,
        transcript_segments_json=record.transcript_segments_json,
        summary_markdown=record.summary_markdown,
        notes_markdown=record.notes_markdown,
        mindmap_markdown=record.mindmap_markdown,
        storage_dir=storage_dir,
    )
    record.artifact_index_json = index_json
    record.artifact_total_bytes = total_bytes
    return True
