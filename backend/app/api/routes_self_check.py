from __future__ import annotations

import asyncio

import orjson
from fastapi import APIRouter, Depends, Request
from starlette.responses import StreamingResponse

from app.errors import AppError
from app.schemas import SelfCheckAutoFixResponse, SelfCheckReportResponse, SelfCheckStartResponse
from app.services.events import EventBus
from app.services.self_check import SelfCheckService

router = APIRouter(prefix="/self-check", tags=["self-check"])


def get_service(request: Request) -> SelfCheckService:
    return request.app.state.self_check_service


def get_event_bus(request: Request) -> EventBus:
    return request.app.state.event_bus


@router.post("/start", response_model=SelfCheckStartResponse)
async def start_self_check(service: SelfCheckService = Depends(get_service)) -> SelfCheckStartResponse:
    session_id = await service.start_check()
    return SelfCheckStartResponse(session_id=session_id, status="running")


@router.post("/{session_id}/auto-fix", response_model=SelfCheckAutoFixResponse)
async def start_auto_fix(
    session_id: str,
    service: SelfCheckService = Depends(get_service),
) -> SelfCheckAutoFixResponse:
    try:
        await service.start_auto_fix(session_id)
    except KeyError as exc:
        raise AppError.not_found(
            f"Self-check session not found: {session_id}",
            code="SELF_CHECK_SESSION_NOT_FOUND",
        ) from exc
    except RuntimeError as exc:
        raise AppError.conflict(str(exc), code="SELF_CHECK_AUTO_FIX_CONFLICT") from exc
    return SelfCheckAutoFixResponse(session_id=session_id, status="fixing")


@router.get("/{session_id}/report", response_model=SelfCheckReportResponse)
async def get_report(
    session_id: str,
    service: SelfCheckService = Depends(get_service),
) -> SelfCheckReportResponse:
    report = await service.get_report(session_id)
    if report is None:
        raise AppError.not_found(
            f"Self-check session not found: {session_id}",
            code="SELF_CHECK_SESSION_NOT_FOUND",
        )
    return SelfCheckReportResponse(**report)


@router.get("/{session_id}/events")
async def stream_self_check_events(
    session_id: str,
    request: Request,
    event_bus: EventBus = Depends(get_event_bus),
) -> StreamingResponse:
    topic = f"self-check:{session_id}"
    subscription = await event_bus.subscribe(topic)

    async def event_generator():
        try:
            for item in subscription.history:
                yield f"data: {orjson.dumps(item).decode('utf-8')}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(subscription.queue.get(), timeout=10)
                    yield f"data: {orjson.dumps(event).decode('utf-8')}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            await event_bus.unsubscribe(topic, subscription.queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
