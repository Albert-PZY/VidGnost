from __future__ import annotations

import orjson
import pytest

from app.services.events import EventBus


@pytest.mark.asyncio
async def test_terminal_history_removed_after_last_unsubscribe() -> None:
    bus = EventBus(history_size=16)
    subscription = await bus.subscribe("task-1")

    await bus.publish("task-1", {"type": "log", "stage": "A", "message": "hello"})
    await bus.publish("task-1", {"type": "task_complete"})

    await bus.unsubscribe("task-1", subscription.queue)
    new_subscription = await bus.subscribe("task-1")

    assert new_subscription.history == []


@pytest.mark.asyncio
async def test_terminal_event_without_subscriber_does_not_keep_history() -> None:
    bus = EventBus(history_size=16)

    await bus.publish("task-2", {"type": "task_failed", "error": "boom"})
    subscription = await bus.subscribe("task-2")

    assert subscription.history == []


@pytest.mark.asyncio
async def test_queue_overflow_keeps_latest_events_without_crash() -> None:
    bus = EventBus(history_size=8)
    subscription = await bus.subscribe("task-3")

    for idx in range(700):
        await bus.publish("task-3", {"type": "log", "stage": "A", "message": f"log-{idx}"})

    assert subscription.queue.qsize() <= 512


@pytest.mark.asyncio
async def test_event_bus_adds_trace_id_and_writes_jsonl(tmp_path) -> None:
    bus = EventBus(history_size=8, event_log_dir=str(tmp_path))

    first = await bus.publish("task-4", {"type": "log", "stage": "A", "message": "hello"})
    second = await bus.publish("task-4", {"type": "log", "stage": "A", "message": "world"})

    assert str(first["trace_id"]).startswith("task-4-")
    assert str(second["trace_id"]).startswith("task-4-")
    assert first["trace_id"] != second["trace_id"]
    await bus.close()

    log_path = tmp_path / "task-4.jsonl"
    assert log_path.exists()
    entries = [orjson.loads(line) for line in log_path.read_bytes().splitlines() if line.strip()]
    assert len(entries) == 2
    assert entries[0]["message"] == "hello"
    assert entries[1]["message"] == "world"
