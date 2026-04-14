from __future__ import annotations

import pytest

from app.services.developer_log_service import DeveloperLogFilters, DeveloperLogService


@pytest.mark.asyncio
async def test_developer_log_service_filters_and_subscription(tmp_path) -> None:
    service = DeveloperLogService(log_dir=str(tmp_path))

    first = await service.publish(
        category="frontend",
        level="info",
        source="frontend.page",
        message="进入开发者模式",
        event_type="view_change",
    )
    second = await service.publish(
        category="error",
        level="error",
        source="api.error_handlers",
        message="Unhandled exception",
        trace_id="trace-1",
        event_type="unhandled_exception",
    )

    warning_and_above = await service.list_logs(
        filters=DeveloperLogFilters.from_values(level="warning"),
        limit=20,
    )
    frontend_subscription = await service.subscribe(
        filters=DeveloperLogFilters.from_values(category="frontend"),
        history_limit=20,
    )

    assert [entry["id"] for entry in warning_and_above] == [second["id"]]
    assert [entry["id"] for entry in frontend_subscription.history] == [first["id"]]


@pytest.mark.asyncio
async def test_developer_log_service_observes_task_event_payload(tmp_path) -> None:
    service = DeveloperLogService(log_dir=str(tmp_path))

    await service.observe_event_bus(
        "task-1",
        {
            "type": "task_failed",
            "task_id": "task-1",
            "stage": "D",
            "error": "boom",
        },
    )

    items = await service.list_logs(limit=10)

    assert len(items) == 1
    assert items[0]["category"] == "task"
    assert items[0]["level"] == "error"
    assert items[0]["task_id"] == "task-1"
    assert items[0]["message"] == "boom"
