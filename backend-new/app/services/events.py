from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

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
        self._terminal_tasks: set[str] = set()
        self._trace_sequence: dict[str, int] = defaultdict(int)
        self._event_log_dir = Path(event_log_dir).resolve() if event_log_dir else None
        if self._event_log_dir is not None:
            self._event_log_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    async def publish(self, task_id: str, payload: dict) -> dict:
        trace_id = str(payload.get("trace_id", "")).strip()
        if not trace_id:
            self._trace_sequence[task_id] += 1
            trace_id = f"{task_id}-{self._trace_sequence[task_id]}"
        event = {
            "task_id": task_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "trace_id": trace_id,
            **payload,
        }
        event_type = str(payload.get("type", ""))
        async with self._lock:
            self._history[task_id].append(event)
            queues = tuple(self._subscribers.get(task_id, []))
            if event_type in TERMINAL_EVENT_TYPES:
                self._terminal_tasks.add(task_id)
                if not queues:
                    self._history.pop(task_id, None)
                    self._terminal_tasks.discard(task_id)
        await self._append_event_log(task_id, event)
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

    async def subscribe(self, task_id: str) -> EventSubscription:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=512)
        async with self._lock:
            self._subscribers[task_id].append(queue)
            history = list(self._history.get(task_id, deque()))
        return EventSubscription(queue=queue, history=history)

    async def unsubscribe(self, task_id: str, queue: asyncio.Queue[dict]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(task_id)
            if not subscribers:
                return
            self._subscribers[task_id] = [subscriber for subscriber in subscribers if subscriber is not queue]
            if not self._subscribers[task_id]:
                self._subscribers.pop(task_id, None)
                if task_id in self._terminal_tasks:
                    self._terminal_tasks.discard(task_id)
                    self._history.pop(task_id, None)

    async def reset_task(self, task_id: str, *, clear_pending_queues: bool = True) -> None:
        async with self._lock:
            self._history.pop(task_id, None)
            self._terminal_tasks.discard(task_id)
            self._trace_sequence.pop(task_id, None)
            if not clear_pending_queues:
                return
            for queue in self._subscribers.get(task_id, []):
                while True:
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break

    async def _append_event_log(self, task_id: str, event: dict) -> None:
        if self._event_log_dir is None:
            return

        def _write_line() -> None:
            path = self._event_log_dir / f"{task_id}.jsonl"
            payload = orjson.dumps(event) + b"\n"
            with path.open("ab") as handle:
                handle.write(payload)

        try:
            await asyncio.to_thread(_write_line)
        except OSError:
            return
