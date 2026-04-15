from __future__ import annotations

import asyncio
import inspect
import re
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

import orjson

TERMINAL_EVENT_TYPES = frozenset(
    {
        "task_complete",
        "task_failed",
        "task_cancelled",
        "self_check_complete",
        "self_check_failed",
        "self_fix_complete",
        "self_fix_failed",
    }
)


@dataclass(slots=True)
class EventSubscription:
    queue: asyncio.Queue[dict]
    history: list[dict]


class EventBus:
    def __init__(self, history_size: int = 2000, event_log_dir: str | None = None) -> None:
        self._history_size = history_size
        self._history: dict[str, deque[dict]] = defaultdict(lambda: deque(maxlen=self._history_size))
        self._subscribers: dict[str, list[asyncio.Queue[dict]]] = defaultdict(list)
        self._observers: list[Callable[[str, dict], Awaitable[None] | None]] = []
        self._terminal_tasks: set[str] = set()
        self._trace_sequence: dict[str, int] = defaultdict(int)
        self._event_log_dir = Path(event_log_dir).resolve() if event_log_dir else None
        if self._event_log_dir is not None:
            self._event_log_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    def add_observer(self, observer: Callable[[str, dict], Awaitable[None] | None]) -> None:
        self._observers.append(observer)

    async def publish(self, topic: str, payload: dict) -> dict:
        trace_id = str(payload.get("trace_id", "")).strip()
        if not trace_id:
            self._trace_sequence[topic] += 1
            trace_id = f"{topic}-{self._trace_sequence[topic]}"
        event = {
            "topic": topic,
            "task_id": str(payload.get("task_id", "")).strip() or topic,
            "ts": datetime.now(timezone.utc).isoformat(),
            "trace_id": trace_id,
            **payload,
        }
        event_type = str(payload.get("type", ""))
        async with self._lock:
            self._history[topic].append(event)
            queues = tuple(self._subscribers.get(topic, []))
            if event_type in TERMINAL_EVENT_TYPES:
                self._terminal_tasks.add(topic)
                if not queues:
                    self._history.pop(topic, None)
                    self._terminal_tasks.discard(topic)
        await self._append_event_log(topic, event)
        await self._notify_observers(topic, event)
        for queue in queues:
            if queue.full():
                try:
                    _ = queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    _ = queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
        return event

    async def subscribe(self, topic: str) -> EventSubscription:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=512)
        async with self._lock:
            self._subscribers[topic].append(queue)
            history = list(self._history.get(topic, deque()))
        return EventSubscription(queue=queue, history=history)

    async def unsubscribe(self, topic: str, queue: asyncio.Queue[dict]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(topic)
            if not subscribers:
                return
            self._subscribers[topic] = [subscriber for subscriber in subscribers if subscriber is not queue]
            if not self._subscribers[topic]:
                self._subscribers.pop(topic, None)
                if topic in self._terminal_tasks:
                    self._terminal_tasks.discard(topic)
                    self._history.pop(topic, None)

    async def reset_task(self, topic: str, *, clear_pending_queues: bool = True) -> None:
        async with self._lock:
            self._history.pop(topic, None)
            self._terminal_tasks.discard(topic)
            self._trace_sequence.pop(topic, None)
            if not clear_pending_queues:
                return
            for queue in self._subscribers.get(topic, []):
                while True:
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break

    async def _append_event_log(self, topic: str, event: dict) -> None:
        if self._event_log_dir is None:
            return

        def _write_line() -> None:
            path = self._event_log_dir / f"{_safe_topic_name(topic)}.jsonl"
            payload = orjson.dumps(event) + b"\n"
            with path.open("ab") as handle:
                handle.write(payload)

        try:
            await asyncio.to_thread(_write_line)
        except OSError:
            return

    async def _notify_observers(self, topic: str, event: dict) -> None:
        for observer in tuple(self._observers):
            try:
                result = observer(topic, event)
                if inspect.isawaitable(result):
                    await result
            except Exception:
                continue


def _safe_topic_name(topic: str) -> str:
    sanitized = re.sub(r"[<>:\"/\\\\|?*]+", "_", topic).strip(" .")
    return sanitized or "event-stream"
