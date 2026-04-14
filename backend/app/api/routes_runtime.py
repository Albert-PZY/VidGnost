from __future__ import annotations

from pathlib import Path

import asyncio

import orjson
from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import StreamingResponse

from app.schemas import (
    DeveloperLogEntryResponse,
    DeveloperLogFrontendCreateRequest,
    DeveloperLogListResponse,
    RuntimeMetricsResponse,
    RuntimePathsResponse,
)
from app.services.developer_log_service import DeveloperLogFilters, DeveloperLogService
from app.services.runtime_metrics import RuntimeMetricsService

router = APIRouter(prefix="/runtime", tags=["runtime"])


def get_runtime_metrics_service(request: Request) -> RuntimeMetricsService:
    return request.app.state.runtime_metrics_service


def get_settings(request: Request):
    return request.app.state.settings


def get_developer_log_service(request: Request) -> DeveloperLogService:
    return request.app.state.developer_log_service


@router.get("/metrics", response_model=RuntimeMetricsResponse)
def get_runtime_metrics(service: RuntimeMetricsService = Depends(get_runtime_metrics_service)) -> RuntimeMetricsResponse:
    return RuntimeMetricsResponse.model_validate(service.collect())


@router.get("/paths", response_model=RuntimePathsResponse)
def get_runtime_paths(request: Request) -> RuntimePathsResponse:
    settings = get_settings(request)
    storage_dir = Path(settings.storage_dir).resolve()
    event_log_dir = storage_dir / "event-logs"
    trace_log_dir = event_log_dir / "traces"
    developer_log_dir = event_log_dir / "developer"
    return RuntimePathsResponse(
        storage_dir=str(storage_dir),
        event_log_dir=str(event_log_dir),
        trace_log_dir=str(trace_log_dir),
        developer_log_dir=str(developer_log_dir),
    )


@router.get("/developer-logs", response_model=DeveloperLogListResponse)
async def get_developer_logs(
    category: str | None = Query(default=None),
    level: str | None = Query(default=None),
    source: str | None = Query(default=None),
    task_id: str | None = Query(default=None),
    trace_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    service: DeveloperLogService = Depends(get_developer_log_service),
) -> DeveloperLogListResponse:
    filters = DeveloperLogFilters.from_values(
        category=category,
        level=level,
        source=source,
        task_id=task_id,
        trace_id=trace_id,
        session_id=session_id,
        query=q,
    )
    items = await service.list_logs(filters=filters, limit=limit)
    return DeveloperLogListResponse(
        items=[DeveloperLogEntryResponse.model_validate(item) for item in items],
        total=len(items),
    )


@router.post("/developer-logs/frontend", response_model=DeveloperLogEntryResponse)
async def create_frontend_developer_log(
    payload: DeveloperLogFrontendCreateRequest,
    service: DeveloperLogService = Depends(get_developer_log_service),
) -> DeveloperLogEntryResponse:
    record = await service.publish(
        category=payload.category,
        level=payload.level,
        source=payload.source,
        message=payload.message,
        topic=payload.topic,
        task_id=payload.task_id,
        trace_id=payload.trace_id,
        session_id=payload.session_id,
        stage=payload.stage,
        substage=payload.substage,
        event_type=payload.event_type,
        payload=dict(payload.payload),
    )
    return DeveloperLogEntryResponse.model_validate(record)


@router.get("/developer-logs/events")
async def stream_developer_logs(
    request: Request,
    category: str | None = Query(default=None),
    level: str | None = Query(default=None),
    source: str | None = Query(default=None),
    task_id: str | None = Query(default=None),
    trace_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
    history_limit: int = Query(default=200, ge=0, le=1000),
    service: DeveloperLogService = Depends(get_developer_log_service),
) -> StreamingResponse:
    filters = DeveloperLogFilters.from_values(
        category=category,
        level=level,
        source=source,
        task_id=task_id,
        trace_id=trace_id,
        session_id=session_id,
        query=q,
    )
    subscription = await service.subscribe(filters=filters, history_limit=history_limit)

    async def event_generator():
        try:
            yield ": connected\n\n"
            for item in subscription.history:
                yield f"data: {orjson.dumps(item).decode('utf-8')}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(subscription.queue.get(), timeout=10)
                    yield f"data: {orjson.dumps(item).decode('utf-8')}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            await service.unsubscribe(subscription.queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
