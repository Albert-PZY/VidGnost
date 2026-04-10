from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import shutil
from threading import RLock
from typing import Iterable, Literal
from urllib.parse import quote, unquote

import orjson

from app.models import TaskRecord

SortBy = Literal["date", "name", "size"]


@dataclass(slots=True)
class TaskListResult:
    items: list[TaskRecord]
    total: int


@dataclass(slots=True)
class TaskStatsResult:
    total: int
    notes: int
    vqa: int
    completed: int


class TaskStore:
    def __init__(self, storage_dir: str) -> None:
        root = Path(storage_dir)
        self._tasks_root = root / "tasks"
        self._records_dir = self._tasks_root / "records"
        self._stage_metrics_dir = self._tasks_root / "stage-metrics"
        self._runtime_warnings_dir = self._tasks_root / "runtime-warnings"
        self._analysis_results_dir = self._tasks_root / "analysis-results"
        self._stage_artifacts_dir = self._tasks_root / "stage-artifacts"
        self._event_logs_dir = root / "event-logs"
        self._lock = RLock()
        self._ensure_layout()

    def create(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            path = self._record_path(record.id)
            if path.exists():
                raise ValueError(f"Task already exists: {record.id}")
            self._write_record(record)
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
            return record

    def replace(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            record.updated_at = datetime.now(timezone.utc)
            self._write_record(record)
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
            return removed

    def list(
        self,
        *,
        q: str | None = None,
        workflow: str | None = None,
        status: str | None = None,
        sort_by: SortBy = "date",
        limit: int = 50,
        offset: int = 0,
    ) -> TaskListResult:
        records = self.list_all()
        if q:
            keyword = q.casefold()
            records = [
                item
                for item in records
                if keyword in (item.title or "").casefold() or keyword in (item.source_input or "").casefold()
            ]
        if workflow and workflow in {"notes", "vqa"}:
            records = [item for item in records if item.workflow == workflow]
        if status:
            status_lower = status.strip().lower()
            records = [item for item in records if item.status.strip().lower() == status_lower]

        if sort_by == "name":
            records.sort(key=lambda item: (item.title or item.source_input or "").casefold())
        elif sort_by == "size":
            records.sort(key=lambda item: int(item.file_size_bytes or 0), reverse=True)
        else:
            records.sort(key=lambda item: item.updated_at, reverse=True)

        total = len(records)
        paged = records[offset : offset + limit]
        return TaskListResult(items=paged, total=total)

    def stats(self) -> TaskStatsResult:
        records = self.list_all()
        total = len(records)
        notes = sum(1 for item in records if item.workflow == "notes")
        vqa = sum(1 for item in records if item.workflow == "vqa")
        completed = sum(1 for item in records if item.status == "completed")
        return TaskStatsResult(total=total, notes=notes, vqa=vqa, completed=completed)

    def recent(self, *, limit: int = 8) -> list[TaskRecord]:
        records = self.list_all()
        records.sort(key=lambda item: item.updated_at, reverse=True)
        return records[: max(1, limit)]

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
