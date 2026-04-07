from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Iterable
from urllib.parse import quote, unquote

import orjson

from app.models import TaskRecord


@dataclass(slots=True)
class TaskListResult:
    items: list[TaskRecord]
    total: int


class TaskStore:
    def __init__(self, storage_dir: str) -> None:
        root = Path(storage_dir)
        self._tasks_root = root / "tasks"
        self._records_dir = self._tasks_root / "records"
        self._index_path = self._tasks_root / "index.json"
        self._stage_metrics_dir = self._tasks_root / "stage-metrics"
        self._runtime_warnings_dir = self._tasks_root / "runtime-warnings"
        self._analysis_results_dir = self._tasks_root / "analysis-results"
        self._stage_artifacts_dir = self._tasks_root / "stage-artifacts"
        self._event_logs_dir = root / "event-logs"
        self._lock = RLock()
        self._ensure_layout()
        self._ensure_index()

    def create(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            path = self._record_path(record.id)
            if path.exists():
                raise ValueError(f"Task already exists: {record.id}")
            self._write_record(record)
            self._upsert_index_record(record)
            return record

    def get(self, task_id: str) -> TaskRecord | None:
        with self._lock:
            path = self._record_path(task_id)
            if not path.exists():
                return None
            return self._read_record(path)

    def update(self, task_id: str, **fields: object) -> TaskRecord:
        with self._lock:
            record = self.get(task_id)
            if record is None:
                raise ValueError(f"Task not found: {task_id}")
            for key, value in fields.items():
                setattr(record, key, value)
            record.updated_at = datetime.now(timezone.utc)
            self._write_record(record)
            self._upsert_index_record(record)
            return record

    def replace(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            record.updated_at = datetime.now(timezone.utc)
            self._write_record(record)
            self._upsert_index_record(record)
            return record

    def delete(self, task_id: str) -> bool:
        with self._lock:
            removed = False
            for path in (
                self._record_path(task_id),
                self._stage_metric_path(task_id),
                self._runtime_warning_path(task_id),
                self._event_log_path(task_id),
            ):
                if path.exists():
                    path.unlink()
                    removed = True
            for directory in (
                self._analysis_result_dir(task_id),
                self._stage_artifact_task_dir(task_id),
            ):
                if directory.exists():
                    shutil.rmtree(directory, ignore_errors=True)
                    removed = True
            self._remove_index_record(task_id)
            return removed

    def list(self, *, q: str | None = None, limit: int = 50, offset: int = 0) -> TaskListResult:
        with self._lock:
            entries = self._read_index_items()
            if q:
                keyword = q.casefold()
                entries = [
                    item
                    for item in entries
                    if keyword in str(item.get("title", "")).casefold()
                    or keyword in str(item.get("source_input", "")).casefold()
                ]
            entries.sort(key=lambda item: str(item.get("updated_at", "")), reverse=True)
            total = len(entries)
            paged_entries = entries[offset : offset + limit]
            records: list[TaskRecord] = []
            stale_task_ids: list[str] = []
            for item in paged_entries:
                task_id = str(item.get("id", "")).strip()
                if not task_id:
                    continue
                path = self._record_path(task_id)
                if not path.exists():
                    stale_task_ids.append(task_id)
                    continue
                try:
                    records.append(self._read_record(path))
                except ValueError:
                    stale_task_ids.append(task_id)
            if stale_task_ids:
                self._remove_index_records(stale_task_ids)
            return TaskListResult(items=records, total=total - len(stale_task_ids))

    def list_all(self) -> list[TaskRecord]:
        with self._lock:
            return list(self._iter_records())

    def upsert_stage_metric(self, task_id: str, stage: str, payload: dict[str, object]) -> None:
        with self._lock:
            path = self._stage_metric_path(task_id)
            data = self._read_json(path, default={})
            if not isinstance(data, dict):
                data = {}
            data[str(stage)] = payload
            self._write_json(path, data)

    def append_runtime_warning(self, task_id: str, payload: dict[str, object]) -> None:
        with self._lock:
            path = self._runtime_warning_path(task_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            line = orjson.dumps(payload) + b"\n"
            with path.open("ab") as file:
                file.write(line)

    def upsert_analysis_result(self, task_id: str, stage: str, payload: dict[str, object]) -> None:
        with self._lock:
            stage_key = str(stage).strip()
            if not stage_key:
                raise ValueError("stage is required")
            path = self._analysis_result_stage_path(task_id, stage_key)
            normalized_payload = dict(payload)
            normalized_payload.setdefault("stage_key", stage_key)
            self._write_json(path, normalized_payload)

    def remove_analysis_results(self, task_id: str, *, prefixes: tuple[str, ...]) -> None:
        with self._lock:
            directory = self._analysis_result_dir(task_id)
            if not directory.exists():
                return
            normalized_prefixes = tuple(prefix for prefix in prefixes if prefix)
            if not normalized_prefixes:
                return
            removed = False
            for stage_path in directory.glob("*.json"):
                stage_key = self._decode_stage_from_path(stage_path)
                if any(stage_key.startswith(prefix) for prefix in normalized_prefixes):
                    stage_path.unlink(missing_ok=True)
                    removed = True
            if removed and not any(directory.iterdir()):
                directory.rmdir()

    def _iter_records(self) -> Iterable[TaskRecord]:
        self._ensure_layout()
        for path in self._records_dir.glob("*.json"):
            try:
                yield self._read_record(path)
            except ValueError:
                continue

    def _read_record(self, path: Path) -> TaskRecord:
        payload = self._read_json(path, default=None)
        if not isinstance(payload, dict):
            raise ValueError(f"Invalid task record payload: {path}")
        record = TaskRecord.from_dict(payload)
        if not record.id:
            fallback_id = path.stem.strip()
            if fallback_id:
                record.id = fallback_id
            else:
                raise ValueError(f"Invalid task id in record: {path}")
        return record

    def _write_record(self, record: TaskRecord) -> None:
        self._ensure_layout()
        path = self._record_path(record.id)
        self._write_json(path, record.to_dict())

    def _ensure_layout(self) -> None:
        for path in (
            self._tasks_root,
            self._records_dir,
            self._stage_metrics_dir,
            self._runtime_warnings_dir,
            self._analysis_results_dir,
            self._stage_artifacts_dir,
            self._event_logs_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def _ensure_index(self) -> None:
        if self._index_path.exists():
            payload = self._read_json(self._index_path, default={})
            if isinstance(payload, dict) and isinstance(payload.get("items"), list):
                return
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        items: list[dict[str, object]] = []
        for record in self._iter_records():
            items.append(self._record_to_index_item(record))
        self._write_index_items(items)

    def _read_index_items(self) -> list[dict[str, object]]:
        payload = self._read_json(self._index_path, default={})
        if not isinstance(payload, dict):
            self._rebuild_index()
            payload = self._read_json(self._index_path, default={})
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            self._rebuild_index()
            payload = self._read_json(self._index_path, default={})
            items = payload.get("items") if isinstance(payload, dict) else []
        normalized: list[dict[str, object]] = []
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    normalized.append(item)
        return normalized

    def _write_index_items(self, items: list[dict[str, object]]) -> None:
        payload = {
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "items": items,
        }
        self._write_json(self._index_path, payload)

    def _record_to_index_item(self, record: TaskRecord) -> dict[str, object]:
        return {
            "id": record.id,
            "title": record.title or "",
            "source_type": record.source_type,
            "source_input": record.source_input,
            "status": record.status,
            "progress": int(record.progress),
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        }

    def _upsert_index_record(self, record: TaskRecord) -> None:
        items = self._read_index_items()
        updated = False
        next_item = self._record_to_index_item(record)
        for index, item in enumerate(items):
            if str(item.get("id", "")).strip() == record.id:
                items[index] = next_item
                updated = True
                break
        if not updated:
            items.append(next_item)
        self._write_index_items(items)

    def _remove_index_record(self, task_id: str) -> None:
        self._remove_index_records([task_id])

    def _remove_index_records(self, task_ids: Iterable[str]) -> None:
        removed_keys = {str(task_id).strip() for task_id in task_ids if str(task_id).strip()}
        if not removed_keys:
            return
        items = self._read_index_items()
        filtered = [item for item in items if str(item.get("id", "")).strip() not in removed_keys]
        if len(filtered) == len(items):
            return
        self._write_index_items(filtered)

    def _record_path(self, task_id: str) -> Path:
        return self._records_dir / f"{task_id}.json"

    def _stage_metric_path(self, task_id: str) -> Path:
        return self._stage_metrics_dir / f"{task_id}.json"

    def _runtime_warning_path(self, task_id: str) -> Path:
        return self._runtime_warnings_dir / f"{task_id}.jsonl"

    def _analysis_result_dir(self, task_id: str) -> Path:
        return self._analysis_results_dir / task_id

    def _analysis_result_stage_path(self, task_id: str, stage: str) -> Path:
        stage_key = quote(stage, safe="")
        return self._analysis_result_dir(task_id) / f"{stage_key}.json"

    def _decode_stage_from_path(self, path: Path) -> str:
        return unquote(path.stem)

    def _stage_artifact_task_dir(self, task_id: str) -> Path:
        return self._stage_artifacts_dir / task_id

    def _event_log_path(self, task_id: str) -> Path:
        return self._event_logs_dir / f"{task_id}.jsonl"

    @staticmethod
    def _read_json(path: Path, *, default: object) -> object:
        if not path.exists():
            return default
        try:
            return orjson.loads(path.read_bytes())
        except orjson.JSONDecodeError:
            return default

    @staticmethod
    def _write_json(path: Path, payload: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_bytes(orjson.dumps(payload))
        temp_path.replace(path)
