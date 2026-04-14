from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import orjson

_LEVEL_PRIORITY = {
    "debug": 10,
    "info": 20,
    "warning": 30,
    "error": 40,
}

_CATEGORY_VALUES = {
    "system",
    "runtime",
    "task",
    "self_check",
    "vqa",
    "frontend",
    "error",
}


@dataclass(slots=True)
class DeveloperLogFilters:
    category: str | None = None
    level: str | None = None
    source: str | None = None
    task_id: str | None = None
    trace_id: str | None = None
    session_id: str | None = None
    query: str | None = None

    @classmethod
    def from_values(
        cls,
        *,
        category: str | None = None,
        level: str | None = None,
        source: str | None = None,
        task_id: str | None = None,
        trace_id: str | None = None,
        session_id: str | None = None,
        query: str | None = None,
    ) -> "DeveloperLogFilters":
        return cls(
            category=_normalize_optional(category),
            level=_normalize_level(level),
            source=_normalize_optional(source),
            task_id=_normalize_optional(task_id),
            trace_id=_normalize_optional(trace_id),
            session_id=_normalize_optional(session_id),
            query=_normalize_optional(query),
        )


@dataclass(slots=True)
class DeveloperLogSubscription:
    queue: asyncio.Queue[dict]
    history: list[dict]


@dataclass(slots=True)
class _Subscriber:
    queue: asyncio.Queue[dict]
    filters: DeveloperLogFilters


class DeveloperLogService:
    def __init__(self, *, history_size: int = 4000, log_dir: str | None = None) -> None:
        self._history: deque[dict] = deque(maxlen=max(200, int(history_size)))
        self._subscribers: list[_Subscriber] = []
        self._sequence = 0
        self._lock = asyncio.Lock()
        self._log_dir = Path(log_dir).resolve() if log_dir else None
        if self._log_dir is not None:
            self._log_dir.mkdir(parents=True, exist_ok=True)

    async def publish(
        self,
        *,
        category: str,
        level: str,
        source: str,
        message: str,
        topic: str | None = None,
        task_id: str | None = None,
        trace_id: str | None = None,
        session_id: str | None = None,
        stage: str | None = None,
        substage: str | None = None,
        event_type: str | None = None,
        payload: dict | None = None,
    ) -> dict:
        normalized_category = _normalize_category(category)
        normalized_level = _normalize_level(level)
        normalized_source = _normalize_optional(source) or "unknown"
        normalized_message = _normalize_optional(message) or "No message"
        normalized_topic = _normalize_optional(topic)
        normalized_task_id = _normalize_optional(task_id)
        normalized_trace_id = _normalize_optional(trace_id)
        normalized_session_id = _normalize_optional(session_id)
        normalized_stage = _normalize_optional(stage)
        normalized_substage = _normalize_optional(substage)
        normalized_event_type = _normalize_optional(event_type)
        normalized_payload = dict(payload) if isinstance(payload, dict) else {}

        async with self._lock:
            self._sequence += 1
            record = {
                "id": f"devlog-{self._sequence:08d}",
                "sequence": self._sequence,
                "ts": datetime.now(timezone.utc).isoformat(),
                "category": normalized_category,
                "level": normalized_level,
                "source": normalized_source,
                "message": normalized_message,
                "topic": normalized_topic or "",
                "task_id": normalized_task_id or "",
                "trace_id": normalized_trace_id or "",
                "session_id": normalized_session_id or "",
                "stage": normalized_stage or "",
                "substage": normalized_substage or "",
                "event_type": normalized_event_type or "",
                "payload": normalized_payload,
            }
            self._history.append(record)
            subscribers = tuple(self._subscribers)

        await self._append_log_file(record)
        for subscriber in subscribers:
            if not _matches_filters(record, subscriber.filters):
                continue
            _enqueue(subscriber.queue, record)
        return record

    async def list_logs(
        self,
        *,
        filters: DeveloperLogFilters | None = None,
        limit: int = 200,
    ) -> list[dict]:
        normalized_limit = max(1, min(1000, int(limit)))
        resolved_filters = filters or DeveloperLogFilters()
        async with self._lock:
            snapshot = list(self._history)

        matched: list[dict] = []
        for record in reversed(snapshot):
            if not _matches_filters(record, resolved_filters):
                continue
            matched.append(record)
            if len(matched) >= normalized_limit:
                break
        matched.reverse()
        return matched

    async def subscribe(
        self,
        *,
        filters: DeveloperLogFilters | None = None,
        history_limit: int = 200,
    ) -> DeveloperLogSubscription:
        resolved_filters = filters or DeveloperLogFilters()
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=512)
        normalized_history_limit = max(0, min(1000, int(history_limit)))

        async with self._lock:
            self._subscribers.append(_Subscriber(queue=queue, filters=resolved_filters))
            history_snapshot = list(self._history)

        history: list[dict] = []
        if normalized_history_limit > 0:
            for record in reversed(history_snapshot):
                if not _matches_filters(record, resolved_filters):
                    continue
                history.append(record)
                if len(history) >= normalized_history_limit:
                    break
            history.reverse()
        return DeveloperLogSubscription(queue=queue, history=history)

    async def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        async with self._lock:
            self._subscribers = [subscriber for subscriber in self._subscribers if subscriber.queue is not queue]

    async def observe_event_bus(self, topic: str, event: dict) -> None:
        normalized_topic = _normalize_optional(topic) or "unknown"
        event_type = _normalize_optional(str(event.get("type", ""))) or "event"
        session_id = ""
        category = "task"
        source = "event_bus.task"
        task_id = _normalize_optional(str(event.get("task_id", "")))
        if normalized_topic.startswith("self-check:"):
            category = "self_check"
            source = "event_bus.self_check"
            session_id = normalized_topic.split(":", 1)[1]
            task_id = ""
        level = _resolve_event_level(event_type=event_type, payload=event)
        message = _build_event_message(topic=normalized_topic, event_type=event_type, payload=event)
        await self.publish(
            category=category,
            level=level,
            source=source,
            message=message,
            topic=normalized_topic,
            task_id=task_id,
            trace_id=_normalize_optional(str(event.get("trace_id", ""))),
            session_id=_normalize_optional(str(event.get("session_id", ""))) or session_id,
            stage=_normalize_optional(str(event.get("stage", ""))),
            substage=_normalize_optional(str(event.get("substage", ""))),
            event_type=event_type,
            payload=dict(event),
        )

    async def _append_log_file(self, record: dict) -> None:
        if self._log_dir is None:
            return

        def _write_line() -> None:
            file_name = datetime.now(timezone.utc).strftime("developer-%Y%m%d.jsonl")
            target_path = self._log_dir / file_name
            payload = orjson.dumps(record) + b"\n"
            with target_path.open("ab") as handle:
                handle.write(payload)

        try:
            await asyncio.to_thread(_write_line)
        except OSError:
            return


def _matches_filters(record: dict, filters: DeveloperLogFilters) -> bool:
    if filters.category and record.get("category") != filters.category:
        return False
    if filters.level and not _level_matches(record.get("level"), filters.level):
        return False
    if filters.source and filters.source.lower() not in str(record.get("source", "")).lower():
        return False
    if filters.task_id and record.get("task_id") != filters.task_id:
        return False
    if filters.trace_id and record.get("trace_id") != filters.trace_id:
        return False
    if filters.session_id and record.get("session_id") != filters.session_id:
        return False
    if filters.query:
        needle = filters.query.lower()
        haystack = " ".join(
            [
                str(record.get("message", "")),
                str(record.get("source", "")),
                str(record.get("category", "")),
                str(record.get("task_id", "")),
                str(record.get("trace_id", "")),
                str(record.get("session_id", "")),
                str(record.get("stage", "")),
                str(record.get("substage", "")),
                str(record.get("event_type", "")),
                _safe_payload_dump(record.get("payload", {})),
            ]
        ).lower()
        if needle not in haystack:
            return False
    return True


def _level_matches(actual: object, minimum: str) -> bool:
    actual_value = _normalize_level(actual)
    return _LEVEL_PRIORITY.get(actual_value, 20) >= _LEVEL_PRIORITY.get(minimum, 20)


def _enqueue(queue: asyncio.Queue[dict], record: dict) -> None:
    if queue.full():
        try:
            _ = queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        queue.put_nowait(record)
    except asyncio.QueueFull:
        try:
            _ = queue.get_nowait()
            queue.put_nowait(record)
        except (asyncio.QueueEmpty, asyncio.QueueFull):
            return


def _normalize_category(value: object) -> str:
    normalized = _normalize_optional(value) or "runtime"
    if normalized in _CATEGORY_VALUES:
        return normalized
    return "runtime"


def _normalize_level(value: object) -> str:
    normalized = _normalize_optional(value) or "info"
    if normalized in _LEVEL_PRIORITY:
        return normalized
    return "info"


def _normalize_optional(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    return normalized


def _resolve_event_level(*, event_type: str, payload: dict) -> str:
    lowered_type = event_type.lower()
    if payload.get("error") or lowered_type.endswith("failed") or lowered_type.endswith("cancelled"):
        return "error"
    if "warning" in lowered_type:
        return "warning"
    if lowered_type.endswith("delta"):
        return "debug"
    return "info"


def _build_event_message(*, topic: str, event_type: str, payload: dict) -> str:
    error_message = _normalize_optional(payload.get("error"))
    if error_message:
        return error_message

    for key in ("message", "text", "title", "status"):
        value = _normalize_optional(payload.get(key))
        if value:
            if key == "status":
                return f"{_humanize_event_type(event_type)}: {value}"
            return value

    stage = _normalize_optional(payload.get("stage"))
    substage = _normalize_optional(payload.get("substage"))
    progress = payload.get("progress")
    parts = [_humanize_event_type(event_type)]
    if stage:
        parts.append(f"阶段 {stage}")
    if substage:
        parts.append(f"子阶段 {substage}")
    if isinstance(progress, (int, float)):
        parts.append(f"进度 {int(progress)}%")
    if topic.startswith("self-check:"):
        parts.append("系统自检")
    return " · ".join(parts)


def _humanize_event_type(value: str) -> str:
    mapping = {
        "log": "运行日志",
        "progress": "进度更新",
        "stage_start": "阶段开始",
        "stage_complete": "阶段完成",
        "substage_start": "子阶段开始",
        "substage_complete": "子阶段完成",
        "transcript_delta": "转写增量",
        "summary_delta": "摘要增量",
        "mindmap_delta": "导图增量",
        "task_complete": "任务完成",
        "task_failed": "任务失败",
        "task_cancelled": "任务取消",
        "task_paused": "任务暂停",
        "self_check_start": "系统自检开始",
        "self_check_complete": "系统自检完成",
        "self_check_failed": "系统自检失败",
        "self_check_fix_start": "自动修复开始",
        "self_check_fix_complete": "自动修复完成",
        "self_fix_failed": "自动修复失败",
    }
    if value in mapping:
        return mapping[value]
    return value.replace("_", " ").strip() or "事件"


def _safe_payload_dump(payload: object) -> str:
    try:
        return orjson.dumps(payload).decode("utf-8", errors="ignore")
    except TypeError:
        return str(payload)
