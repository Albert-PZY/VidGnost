from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Awaitable, Callable, Literal, Protocol

import orjson

from app.services.events import EventBus
from app.services.model_runtime_manager import RuntimeEviction
from app.services.task_artifact_persistence_service import TaskArtifactPersistenceService
from app.services.task_store import TaskStore

StageType = Literal["A", "B", "C", "D"]
DSubstageType = Literal[
    "transcript_optimize",
    "notes_extract",
    "notes_outline",
    "notes_sections",
    "notes_coverage",
    "summary_delivery",
    "mindmap_delivery",
]


class TaskUpdateCallback(Protocol):
    def __call__(self, task_id: str, **fields: object) -> Awaitable[None]: ...


class RuntimeEventService:
    def __init__(
        self,
        *,
        event_bus: EventBus,
        task_store: TaskStore,
        artifact_persistence: TaskArtifactPersistenceService,
        d_substage_titles: dict[DSubstageType, str],
        d_optional_substages: tuple[DSubstageType, ...],
    ) -> None:
        self._event_bus = event_bus
        self._task_store = task_store
        self._artifact_persistence = artifact_persistence
        self._d_substage_titles = d_substage_titles
        self._d_optional_substages = set(d_optional_substages)
        self._task_stage_started: dict[str, dict[StageType, float]] = {}
        self._task_stage_metrics: dict[str, dict[StageType, dict[str, object]]] = {}

    def initialize_task(
        self, task_id: str, stage_metrics: dict[StageType, dict[str, object]]
    ) -> None:
        self._task_stage_started[task_id] = {}
        self._task_stage_metrics[task_id] = stage_metrics

    def clear_task(self, task_id: str) -> None:
        self._task_stage_started.pop(task_id, None)
        self._task_stage_metrics.pop(task_id, None)

    def stage_metrics_json(self, task_id: str) -> str | None:
        metrics = self._task_stage_metrics.get(task_id)
        if not metrics:
            return None
        return orjson.dumps(metrics).decode("utf-8")

    async def stage_start(
        self,
        *,
        task_id: str,
        stage: StageType,
        title: str,
        stage_logs: dict[str, list[str]],
        update_task: TaskUpdateCallback,
        status: str | None = None,
        progress: int | None = None,
    ) -> None:
        payload: dict[str, str | int] = {"type": "stage_start", "stage": stage, "title": title}
        if progress is not None:
            payload["overall_progress"] = progress
        if status:
            payload["status"] = status
        await self._event_bus.publish(task_id, payload)
        self._task_stage_started.setdefault(task_id, {})[stage] = asyncio.get_running_loop().time()
        self.mark_stage_started(task_id, stage)
        await self.emit_log(task_id, stage, f"Stage {stage} started: {title}", stage_logs)
        fields: dict[str, object] = {"stage_logs_json": _encode_stage_logs(stage_logs)}
        if status:
            fields["status"] = status
        if progress is not None:
            fields["progress"] = progress
        await update_task(task_id, **fields)

    async def stage_complete(
        self,
        *,
        task_id: str,
        stage: StageType,
        progress: int,
        stage_logs: dict[str, list[str]],
        update_task: TaskUpdateCallback,
    ) -> None:
        await self._event_bus.publish(
            task_id,
            {
                "type": "stage_complete",
                "stage": stage,
                "overall_progress": progress,
                "stage_progress": 100,
            },
        )
        await self._event_bus.publish(
            task_id,
            {
                "type": "progress",
                "stage": stage,
                "overall_progress": progress,
                "stage_progress": 100,
            },
        )
        self.mark_stage_completed(task_id, stage)
        await self.persist_stage_metric(task_id, stage)
        await self.persist_analysis_result(task_id, stage, status="completed", progress=progress)
        await self.emit_log(task_id, stage, f"Stage {stage} completed", stage_logs)
        await update_task(
            task_id, progress=progress, stage_logs_json=_encode_stage_logs(stage_logs)
        )

    async def d_substage_start(
        self,
        *,
        task_id: str,
        substage: DSubstageType,
        progress: int | None = None,
    ) -> None:
        self.mark_d_substage_started(task_id, substage)
        payload: dict[str, object] = {
            "type": "substage_start",
            "stage": "D",
            "substage": substage,
            "title": self._d_substage_titles[substage],
            "status": "running",
        }
        if progress is not None:
            payload["overall_progress"] = max(0, min(100, int(progress)))
        await self._event_bus.publish(task_id, payload)
        await self.persist_stage_metric(task_id, "D")

    async def d_substage_complete(
        self,
        *,
        task_id: str,
        substage: DSubstageType,
        status: Literal["completed", "skipped", "failed"] = "completed",
        message: str = "",
        progress: int | None = None,
    ) -> None:
        if status == "completed":
            self.mark_d_substage_completed(task_id, substage)
        elif status == "skipped":
            self.mark_d_substage_skipped(task_id, substage, message)
        else:
            self.mark_d_substage_failed(task_id, substage, message)
        payload: dict[str, object] = {
            "type": "substage_complete",
            "stage": "D",
            "substage": substage,
            "title": self._d_substage_titles[substage],
            "status": status,
            "message": message,
        }
        if progress is not None:
            payload["overall_progress"] = max(0, min(100, int(progress)))
        await self._event_bus.publish(task_id, payload)
        await asyncio.to_thread(
            self._task_store.upsert_analysis_result,
            task_id,
            f"D:{substage}",
            {
                "stage": "D",
                "substage": substage,
                "status": status,
                "message": message,
                "progress": progress,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self._artifact_persistence.persist_stage_artifact_json(
            task_id,
            "D",
            f"substage/{substage}.json",
            {
                "task_id": task_id,
                "stage": "D",
                "substage": substage,
                "status": status,
                "message": message,
                "progress": progress,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self.persist_stage_metric(task_id, "D")

    async def emit_log(
        self,
        task_id: str,
        stage: StageType,
        message: str,
        stage_logs: dict[str, list[str]],
        substage: str | None = None,
    ) -> None:
        elapsed_seconds = self.stage_elapsed_seconds(task_id, stage)
        payload: dict[str, object] = {"type": "log", "stage": stage, "message": message}
        if substage:
            payload["substage"] = substage
        if elapsed_seconds is not None:
            payload["elapsed_seconds"] = round(elapsed_seconds, 2)
        await self._event_bus.publish(task_id, payload)
        stage_bucket = stage_logs.setdefault(stage, [])
        stage_bucket.append(
            _format_stage_log_line(message, substage=substage, elapsed_seconds=elapsed_seconds)
        )
        stage_logs[stage] = stage_bucket[-1000:]
        self.increment_stage_log_count(task_id, stage)

    async def emit_runtime_warning(
        self,
        *,
        task_id: str,
        stage: StageType,
        message: str,
        stage_logs: dict[str, list[str]],
        code: str,
        component: str,
        action: str,
        substage: str | None = None,
    ) -> None:
        await self.emit_log(task_id, stage, message, stage_logs, substage=substage)
        payload: dict[str, object] = {
            "type": "runtime_warning",
            "stage": stage,
            "message": message,
            "code": code,
            "component": component,
            "action": action,
        }
        if substage:
            payload["substage"] = substage
        elapsed_seconds = self.stage_elapsed_seconds(task_id, stage)
        if elapsed_seconds is not None:
            payload["elapsed_seconds"] = round(elapsed_seconds, 2)
        await self._event_bus.publish(task_id, payload)
        await self._artifact_persistence.persist_runtime_warning(
            task_id=task_id,
            stage=stage,
            code=code,
            component=component,
            action=action,
            substage=substage,
            message=message,
            elapsed_seconds=elapsed_seconds,
        )

    def stage_elapsed_seconds(self, task_id: str, stage: StageType) -> float | None:
        stage_started = self._task_stage_started.get(task_id, {}).get(stage)
        if stage_started is None:
            return None
        return max(0.0, asyncio.get_running_loop().time() - stage_started)

    def mark_stage_started(self, task_id: str, stage: StageType) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "running"
        stage_entry["started_at"] = now_iso
        stage_entry["completed_at"] = None
        stage_entry["elapsed_seconds"] = None
        stage_entry["reason"] = None

    def mark_stage_completed(self, task_id: str, stage: StageType) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "completed"
        stage_entry["completed_at"] = now_iso
        elapsed_seconds = self.stage_elapsed_seconds(task_id, stage)
        stage_entry["elapsed_seconds"] = (
            round(elapsed_seconds, 2) if elapsed_seconds is not None else None
        )
        stage_entry["reason"] = None

    def mark_stage_failed(self, task_id: str, stage: StageType, reason: str) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "failed"
        stage_entry["completed_at"] = now_iso
        elapsed_seconds = self.stage_elapsed_seconds(task_id, stage)
        stage_entry["elapsed_seconds"] = (
            round(elapsed_seconds, 2) if elapsed_seconds is not None else None
        )
        stage_entry["reason"] = reason

    def mark_d_substage_started(self, task_id: str, substage: DSubstageType) -> None:
        metric = self.ensure_d_substage_metric_entry(task_id, substage)
        metric["status"] = "running"
        metric["started_at"] = datetime.now(timezone.utc).isoformat()
        metric["completed_at"] = None
        metric["elapsed_seconds"] = None

    def mark_d_substage_completed(self, task_id: str, substage: DSubstageType) -> None:
        metric = self.ensure_d_substage_metric_entry(task_id, substage)
        started_at = str(metric.get("started_at", "") or "").strip()
        started_seconds: float | None = None
        if started_at:
            try:
                started_seconds = datetime.fromisoformat(started_at).timestamp()
            except ValueError:
                started_seconds = None
        now_dt = datetime.now(timezone.utc)
        metric["status"] = "completed"
        metric["completed_at"] = now_dt.isoformat()
        if started_seconds is None:
            metric["elapsed_seconds"] = None
        else:
            metric["elapsed_seconds"] = round(max(0.0, now_dt.timestamp() - started_seconds), 2)

    def mark_d_substage_skipped(
        self, task_id: str, substage: DSubstageType, reason: str = ""
    ) -> None:
        metric = self.ensure_d_substage_metric_entry(task_id, substage)
        now_iso = datetime.now(timezone.utc).isoformat()
        metric["status"] = "skipped"
        metric["started_at"] = now_iso
        metric["completed_at"] = now_iso
        metric["elapsed_seconds"] = 0.0
        if reason:
            metric["reason"] = reason

    def mark_d_substage_failed(self, task_id: str, substage: DSubstageType, reason: str) -> None:
        metric = self.ensure_d_substage_metric_entry(task_id, substage)
        now_iso = datetime.now(timezone.utc).isoformat()
        metric["status"] = "failed"
        metric["completed_at"] = now_iso
        if reason:
            metric["reason"] = reason

    def increment_stage_log_count(self, task_id: str, stage: StageType) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        current = int(stage_entry.get("log_count", 0))
        stage_entry["log_count"] = current + 1

    def set_stage_metric_values(
        self, task_id: str, stage: StageType, values: dict[str, object]
    ) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        stage_entry.update(values)

    def record_runtime_lease(self, task_id: str, stage: StageType, wait_seconds: float) -> None:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        current_wait = float(stage_entry.get("runtime_wait_seconds", 0.0) or 0.0)
        stage_entry["runtime_wait_seconds"] = round(
            max(0.0, current_wait + max(0.0, wait_seconds)), 2
        )
        current_lock_count = int(stage_entry.get("runtime_lock_count", 0) or 0)
        stage_entry["runtime_lock_count"] = current_lock_count + 1

    async def handle_runtime_evictions(
        self,
        *,
        task_id: str,
        stage: StageType,
        evictions: tuple[RuntimeEviction, ...],
        stage_logs: dict[str, list[str]],
        evict_runtime_model: Callable[[RuntimeEviction], bool],
    ) -> None:
        if not evictions:
            return
        stage_entry = self.ensure_task_stage_metric_entry(task_id, stage)
        current_eviction_count = int(stage_entry.get("runtime_eviction_count", 0) or 0)
        stage_entry["runtime_eviction_count"] = current_eviction_count + len(evictions)
        for eviction in evictions:
            released = await asyncio.to_thread(evict_runtime_model, eviction)
            suffix = "released" if released else "release skipped"
            await self.emit_log(
                task_id,
                stage,
                (
                    f"Runtime eviction ({eviction.reason}): "
                    f"{eviction.component}:{eviction.model_id} ({suffix})"
                ),
                stage_logs,
                substage="runtime",
            )

    async def persist_stage_metric(self, task_id: str, stage: StageType) -> None:
        stage_metrics = self._task_stage_metrics.get(task_id)
        if not stage_metrics:
            return
        stage_entry = dict(stage_metrics.get(stage) or {})
        metric_payload = {
            "task_id": task_id,
            "stage": stage,
            "started_at": str(stage_entry.get("started_at") or "").strip() or None,
            "completed_at": str(stage_entry.get("completed_at") or "").strip() or None,
            "elapsed_seconds": _to_optional_float(stage_entry.get("elapsed_seconds")),
            "log_count": int(stage_entry.get("log_count", 0) or 0),
            "scheduler_mode": str(stage_entry.get("scheduler_mode", "") or ""),
            "scheduler_wait_seconds": float(stage_entry.get("scheduler_wait_seconds", 0.0) or 0.0),
            "runtime_wait_seconds": float(stage_entry.get("runtime_wait_seconds", 0.0) or 0.0),
            "runtime_lock_count": int(stage_entry.get("runtime_lock_count", 0) or 0),
            "runtime_eviction_count": int(stage_entry.get("runtime_eviction_count", 0) or 0),
            "metrics_json": orjson.dumps(stage_entry).decode("utf-8"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        def _write_stage_metric() -> None:
            self._task_store.upsert_stage_metric(
                task_id=task_id, stage=stage, payload=metric_payload
            )

        await asyncio.to_thread(_write_stage_metric)

    async def persist_analysis_result(
        self,
        task_id: str,
        stage: StageType,
        *,
        status: str,
        progress: int,
        reason: str | None = None,
    ) -> None:
        stage_snapshot = dict(self._task_stage_metrics.get(task_id, {}).get(stage, {}))
        payload: dict[str, object] = {
            "stage": stage,
            "status": status,
            "progress": progress,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "metrics": stage_snapshot,
        }
        if reason:
            payload["reason"] = reason
        await asyncio.to_thread(self._task_store.upsert_analysis_result, task_id, stage, payload)

    def ensure_task_stage_metric_entry(self, task_id: str, stage: StageType) -> dict[str, object]:
        stage_metrics = self._task_stage_metrics.setdefault(task_id, _empty_stage_metrics())
        return stage_metrics.setdefault(
            stage,
            {
                "started_at": None,
                "completed_at": None,
                "elapsed_seconds": None,
                "status": "pending",
                "reason": None,
                "log_count": 0,
                "scheduler_mode": "",
                "scheduler_wait_seconds": 0.0,
                "runtime_wait_seconds": 0.0,
                "runtime_lock_count": 0,
                "runtime_eviction_count": 0,
            },
        )

    def ensure_d_substage_metric_entry(
        self, task_id: str, substage: DSubstageType
    ) -> dict[str, object]:
        stage_entry = self.ensure_task_stage_metric_entry(task_id, "D")
        raw_metrics = stage_entry.setdefault("substage_metrics", {})
        if not isinstance(raw_metrics, dict):
            raw_metrics = {}
            stage_entry["substage_metrics"] = raw_metrics
        metric = raw_metrics.get(substage)
        if not isinstance(metric, dict):
            metric = {
                "title": self._d_substage_titles[substage],
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "elapsed_seconds": None,
                "optional": substage in self._d_optional_substages,
            }
            raw_metrics[substage] = metric
        return metric


def _encode_stage_logs(stage_logs: dict[str, list[str]]) -> str:
    return orjson.dumps(stage_logs).decode("utf-8")


def _format_stage_log_line(
    message: str, *, substage: str | None, elapsed_seconds: float | None
) -> str:
    prefixes: list[str] = []
    if substage:
        prefixes.append(f"[{substage}]")
    if elapsed_seconds is not None:
        prefixes.append(f"[+{elapsed_seconds:.1f}s]")
    if not prefixes:
        return message
    return f"{' '.join(prefixes)} {message}"


def _to_optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _empty_stage_metrics() -> dict[StageType, dict[str, object]]:
    metrics: dict[StageType, dict[str, object]] = {
        stage: {
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": None,
            "status": "pending",
            "reason": None,
            "log_count": 0,
            "scheduler_mode": "",
            "scheduler_wait_seconds": 0.0,
            "runtime_wait_seconds": 0.0,
            "runtime_lock_count": 0,
            "runtime_eviction_count": 0,
        }
        for stage in ("A", "B", "C", "D")
    }
    metrics["D"]["substage_metrics"] = {}
    return metrics
